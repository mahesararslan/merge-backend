import {
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsInt,
  IsString,
  IsOptional,
  ArrayMaxSize,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

class FocusEventDto {
  @IsString()
  @IsIn([
    'focused',
    'no_face',
    'looking_away',
    'eyes_closed',
    'drowsy',
    'looking_down',
    'tab_switched',
    'multi_face',
  ])
  state: string;

  @IsNumber()
  @Min(0)
  startedAt: number;

  @IsOptional()
  @IsNumber()
  endedAt: number | null;

  @IsNumber()
  @Min(0)
  durationMs: number;
}

export class SaveFocusReportDto {
  @IsNumber()
  @Min(0)
  trackingStartedAt: number;

  @IsNumber()
  @Min(0)
  trackingEndedAt: number;

  @IsInt()
  @Min(0)
  totalDurationMs: number;

  @IsInt()
  @Min(0)
  focusedMs: number;

  @IsInt()
  @Min(0)
  distractedMs: number;

  @IsInt()
  @Min(0)
  noFaceMs: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  focusScore: number;

  @IsInt()
  @Min(0)
  longestFocusedStreakMs: number;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => FocusEventDto)
  events: FocusEventDto[];
}
