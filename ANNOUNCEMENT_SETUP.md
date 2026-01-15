# Announcement System - Setup and Routes

## Setup Instructions

### 1. Install Required Packages

```bash
npm install @nestjs/bull bull firebase-admin @nestjs/axios
```

### 2. Environment Variables

Add these to your `.env` file:

```env
# Redis (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Firebase Cloud Messaging
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project-id.iam.gserviceaccount.com

# WebSocket Server
COMMUNICATIONS_SERVER_URL=http://localhost:3001
```

### 3. Update app.module.ts

Import the new modules:

```typescript
import { FirebaseModule } from './firebase/firebase.module';
import { QueueModule } from './queue/queue.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [
    // ... existing imports
    FirebaseModule,
    QueueModule,
    AnnouncementModule,
    NotificationModule,
    // ... other imports
  ],
})
export class AppModule {}
```

### 4. Run Database Migrations

The new entities that need to be in your database:
- `fcm_tokens`
- `announcements` (update with new fields)
- `notifications` (if not already exists)

---

## API Routes

### User Routes

#### Store FCM Token
**Method:** `POST`  
**URL:** `{{baseUrl}}/user/fcm-token`  
**Access:** Authenticated users  
**Headers:**
```
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "token": "fcm-device-token-here",
  "deviceType": "web",
  "deviceId": "optional-device-id"
}
```

---

### Announcement Routes

#### 1. Create Announcement (Publish Now)
**Method:** `POST`  
**URL:** `{{baseUrl}}/announcements/create`  
**Access:** MODERATOR, ADMIN  
**Headers:**
```
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "roomId": "room-uuid",
  "title": "Important Announcement",
  "content": "This is the announcement content",
  "isPublished": true
}
```

**Notes:**
- If `isPublished` is `true`, notifications are sent immediately
- If `isPublished` is `false` or omitted, it's saved as a draft

---

#### 2. Schedule Announcement (Publish Later)
**Method:** `POST`  
**URL:** `{{baseUrl}}/announcements/schedule`  
**Access:** MODERATOR, ADMIN  
**Headers:**
```
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "roomId": "room-uuid",
  "title": "Scheduled Announcement",
  "content": "This will be published later",
  "scheduledAt": "2026-01-20T10:00:00.000Z"
}
```

**Notes:**
- Uses BullMQ to schedule the job
- Automatically publishes and sends notifications at `scheduledAt` time
- `scheduledAt` must be in the future

---

#### 3. Get All Announcements
**Method:** `GET`  
**URL:** `{{baseUrl}}/announcements?roomId={{roomId}}&page=1&limit=20&filter=published`  
**Access:** MEMBER, MODERATOR, ADMIN  
**Headers:**
```
Authorization: Bearer {{accessToken}}
```
**Query Params:**
- `roomId` (required) - Room UUID
- `page` (optional, default: 1)
- `limit` (optional, default: 20)
- `sortBy` (optional: createdAt, scheduledAt, title, default: createdAt)
- `sortOrder` (optional: ASC, DESC, default: DESC)
- `filter` (optional: all, published, scheduled, draft, default: all)

---

#### 4. Get Single Announcement
**Method:** `GET`  
**URL:** `{{baseUrl}}/announcements/:id?roomId={{roomId}}`  
**Access:** MEMBER, MODERATOR, ADMIN  
**Headers:**
```
Authorization: Bearer {{accessToken}}
```
**Query Params:**
- `roomId` (required)

---

#### 5. Update Announcement
**Method:** `PATCH`  
**URL:** `{{baseUrl}}/announcements/:id`  
**Access:** MODERATOR, ADMIN (Only author can update)  
**Headers:**
```
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```
**Body:**
```json
{
  "roomId": "room-uuid",
  "title": "Updated Title",
  "content": "Updated content",
  "isPublished": true
}
```

**Notes:**
- Only the original author can update
- If changing `isPublished` from `false` to `true`, notifications will be sent
- Sets `isEdited` to `true` if title or content is modified

---

#### 6. Delete Announcement
**Method:** `DELETE`  
**URL:** `{{baseUrl}}/announcements/:id?roomId={{roomId}}`  
**Access:** MODERATOR, ADMIN (Author or Room Admin can delete)  
**Headers:**
```
Authorization: Bearer {{accessToken}}
```
**Query Params:**
- `roomId` (required)

**Notes:**
- Can be deleted by:
  - Original author
  - Room admin

---

## Notification Flow

### When Announcement is Published

1. **Notification Created in Database**
   - One notification per room member (excluding author)
   - Stored in `notifications` table with metadata

2. **FCM Push Notification Sent**
   - Retrieves all FCM tokens for room members
   - Sends multicast notification via Firebase
   - Marks notifications as `pushSent: true`

3. **WebSocket Server Notified**
   - Makes HTTP POST to `COMMUNICATIONS_SERVER_URL/internal/announcement-published`
   - WebSocket server broadcasts to connected users in real-time

### Scheduled Announcements

1. **Created with `isPublished: false`**
2. **BullMQ job scheduled** for `scheduledAt` time
3. **Worker executes at scheduled time:**
   - Updates `isPublished` to `true`
   - Triggers notification flow (DB + FCM + WebSocket)

---

## Response Examples

### Create/Schedule Announcement Response
```json
{
  "id": "announcement-uuid",
  "title": "Announcement Title",
  "content": "Announcement content",
  "isPublished": true,
  "isEdited": false,
  "scheduledAt": null,
  "createdAt": "2026-01-14T10:00:00.000Z",
  "editedAt": "2026-01-14T10:00:00.000Z",
  "room": {
    "id": "room-uuid",
    "title": "Room Name"
  },
  "author": {
    "id": "user-uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "image": "profile-url"
  }
}
```

### Get All Announcements Response
```json
{
  "announcements": [...],
  "total": 50,
  "totalPages": 3,
  "currentPage": 1
}
```

---

## Architecture Overview

### Components Created

1. **Entities**
   - `fcm-token.entity.ts` - Stores FCM device tokens per user
   - `announcement.entity.ts` - Updated with scheduling fields

2. **Services**
   - `firebase.service.ts` - Firebase Admin SDK for FCM
   - `notification.service.ts` - Creates and sends notifications
   - `announcement.service.ts` - CRUD + scheduling logic

3. **Queue System**
   - `queue.module.ts` - BullMQ configuration
   - `announcement.processor.ts` - Handles scheduled publishing

4. **Controllers**
   - `announcement.controller.ts` - All announcement routes
   - `user.controller.ts` - FCM token storage route

### Data Flow

```
Client → API Server → [Create/Schedule Announcement]
                ↓
         [If Published Now]
                ↓
         Save to DB → Notification Service
                ↓                    ↓
         WebSocket ←          FCM Push
         Server                Notification

         [If Scheduled]
                ↓
         BullMQ Job → Wait → Worker → [Same as Published Now]
```

---

## Error Handling

- All services have try-catch blocks with logging
- FCM failures don't block the main flow
- WebSocket server failures are logged but don't throw errors
- Scheduled jobs retry on failure (Bull default behavior)

---

## Testing Checklist

- [ ] Store FCM token
- [ ] Create announcement with `isPublished: true`
- [ ] Verify notification in DB
- [ ] Verify FCM notification received
- [ ] Create scheduled announcement
- [ ] Verify BullMQ job created
- [ ] Wait for scheduled time and verify auto-publish
- [ ] Update announcement (only author)
- [ ] Delete announcement (author or admin)
- [ ] Test room guard on all routes
