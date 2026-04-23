import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepgramClient } from '@deepgram/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as PDFDocument from 'pdfkit';

interface SessionTranscription {
  socket: any;
  segments: string[];
  isOpen: boolean;
  pendingChunks: Buffer[];
}

@Injectable()
export class TranscriptionService implements OnModuleDestroy {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly sessions = new Map<string, SessionTranscription>();

  private readonly deepgramApiKey: string;
  private readonly geminiApiKey: string;
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly awsRegion: string;

  constructor(private readonly configService: ConfigService) {
    this.deepgramApiKey = this.configService.get<string>('DEEPGRAM_API_KEY') || '';
    this.geminiApiKey = this.configService.get<string>('GEMINI_API_KEY') || '';

    this.awsRegion = this.configService.get<string>('AWS_S3_REGION') || 'us-east-1';
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME') || '';

    this.s3Client = new S3Client({
      region: this.awsRegion,
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
    });
  }

  onModuleDestroy() {
    for (const [sessionId, session] of this.sessions.entries()) {
      try {
        if (session.socket) session.socket.finish();
      } catch (_) {}
      this.sessions.delete(sessionId);
    }
  }

  startSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.logger.warn(`Transcription already active for session ${sessionId}`);
      return;
    }

    if (!this.deepgramApiKey) {
      this.logger.error('DEEPGRAM_API_KEY is not configured');
      return;
    }

    const state: SessionTranscription = {
      socket: null,
      segments: [],
      isOpen: false,
      pendingChunks: [],
    };

    this.sessions.set(sessionId, state);
    this.logger.log(`Transcription started for session ${sessionId}`);

    this.initDeepgramConnection(sessionId, state).catch((err) => {
      this.logger.error(`Failed to init Deepgram for session ${sessionId}: ${err?.message || err}`);
    });
  }

  private async initDeepgramConnection(sessionId: string, state: SessionTranscription): Promise<void> {
    const deepgram = new (DeepgramClient as any)({ apiKey: this.deepgramApiKey });

    const socket = await (deepgram as any).listen.v1.createConnection({
      model: 'nova-2',
      language: 'en',
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      interim_results: false,
    });

    state.socket = socket;

    socket.on('message', (data: any) => {
      if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
        const transcript = data.channel.alternatives[0].transcript?.trim();
        if (transcript && data.is_final) {
          this.logger.debug(`[${sessionId}] transcript segment: "${transcript.slice(0, 60)}..."`);
          state.segments.push(transcript);
        }
      }
    });

    socket.on('close', () => {
      this.logger.log(`Deepgram connection closed for session ${sessionId}`);
      state.isOpen = false;
    });

    socket.on('error', (err: any) => {
      this.logger.error(
        `Deepgram error for session ${sessionId}: ${err?.message || JSON.stringify(err)}`,
      );
    });

    socket.connect();
    await socket.waitForOpen();

    state.isOpen = true;
    this.logger.log(`Deepgram connection opened for session ${sessionId}`);

    for (const chunk of state.pendingChunks) {
      socket.sendMedia(chunk);
    }
    state.pendingChunks = [];
  }

  sendAudio(sessionId: string, chunk: Buffer): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    if (state.isOpen && state.socket) {
      state.socket.sendMedia(chunk);
    } else {
      state.pendingChunks.push(chunk);
    }
  }

  async finalizeTranscript(sessionId: string): Promise<string> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return '';
    }

    try {
      if (state.socket) state.socket.finish();
    } catch (_) {}

    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    const fullText = state.segments.join(' ').trim();
    this.sessions.delete(sessionId);

    this.logger.log(`Transcript finalized for session ${sessionId}: ${fullText.length} chars`);
    return fullText;
  }

  async generateNotesAndPdf(
    sessionId: string,
    sessionTitle: string,
    transcript: string,
  ): Promise<{ summaryText: string; summaryPdfUrl: string }> {
    const summaryText = await this.generateNotesWithGemini(sessionTitle, transcript);
    const summaryPdfUrl = await this.buildAndUploadPdf(sessionId, sessionTitle, summaryText);
    return { summaryText, summaryPdfUrl };
  }

  private async generateNotesWithGemini(sessionTitle: string, transcript: string): Promise<string> {
    if (!this.geminiApiKey) {
      this.logger.error('GEMINI_API_KEY is not configured');
      return '';
    }

    const genAI = new GoogleGenerativeAI(this.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are a study notes generator. Given the following lecture/session transcript, produce structured study notes in exactly this format. Use plain text, no markdown symbols like **, ##, or *.

SESSION SUMMARY
Write a 2-3 sentence overview of what was covered in this session.

KEY TOPICS
For each major topic discussed, write the topic name followed by bullet points (use a dash "-" prefix). Leave a blank line between topics.

IMPORTANT TERMS
List any concepts, terminology, or definitions introduced. Format each as: term: definition

ACTION ITEMS
List any assignments, tasks, deadlines, or follow-ups mentioned by the host. If none, write "None mentioned."

---
Session Title: ${sessionTitle}

Transcript:
${transcript}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      this.logger.log(`Gemini notes generated for session (title: ${sessionTitle})`);
      return text;
    } catch (error: any) {
      this.logger.error(`Gemini generation failed: ${error?.message}`);
      return '';
    }
  }

  private async buildAndUploadPdf(
    sessionId: string,
    sessionTitle: string,
    notesText: string,
  ): Promise<string> {
    const pdfBuffer = await this.buildPdfBuffer(sessionTitle, notesText);

    const key = `live-session-notes/${sessionId}.pdf`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        }),
      );

      const url = `https://${this.bucketName}.s3.${this.awsRegion}.amazonaws.com/${key}`;
      this.logger.log(`Session notes PDF uploaded to ${url}`);
      return url;
    } catch (error: any) {
      this.logger.error(`S3 upload failed for session ${sessionId}: ${error?.message}`);
      return '';
    }
  }

  private buildPdfBuffer(sessionTitle: string, notesText: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 100;

      doc
        .fontSize(22)
        .fillColor('#1a1a2e')
        .text('Session Study Notes', { align: 'center' });

      doc.moveDown(0.3);
      doc
        .fontSize(14)
        .fillColor('#444')
        .text(sessionTitle, { align: 'center' });

      doc.moveDown(0.3);
      doc
        .fontSize(10)
        .fillColor('#888')
        .text(`Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { align: 'center' });

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(1);

      const sectionHeaders = ['SESSION SUMMARY', 'KEY TOPICS', 'IMPORTANT TERMS', 'ACTION ITEMS'];
      const lines = notesText.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          doc.moveDown(0.4);
          continue;
        }

        if (sectionHeaders.includes(trimmed)) {
          doc.moveDown(0.5);
          doc
            .fontSize(13)
            .fillColor('#1a1a2e')
            .text(trimmed, { underline: false });
          doc.moveDown(0.2);
          doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor('#e0e0e0').stroke();
          doc.moveDown(0.4);
        } else if (trimmed.startsWith('- ')) {
          doc
            .fontSize(10)
            .fillColor('#333')
            .text(`• ${trimmed.slice(2)}`, { indent: 15, lineGap: 2 });
        } else if (trimmed.includes(':') && !trimmed.startsWith('http')) {
          const colonIdx = trimmed.indexOf(':');
          const term = trimmed.slice(0, colonIdx).trim();
          const definition = trimmed.slice(colonIdx + 1).trim();
          doc
            .fontSize(10)
            .fillColor('#1a1a2e')
            .text(term, { continued: true })
            .fillColor('#555')
            .text(`: ${definition}`, { lineGap: 2 });
        } else {
          doc
            .fontSize(10)
            .fillColor('#333')
            .text(trimmed, { lineGap: 2 });
        }
      }

      doc.end();
    });
  }
}
