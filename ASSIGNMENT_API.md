# Assignment API Documentation

This document provides comprehensive information about the Assignment system API endpoints.

## Overview

The Assignment system allows:
- **Room Admins**: Create assignments, upload assignment files, view all submissions, score attempts
- **Room Members**: View assignments, submit attempts, upload submission files, view their own scores

All routes require JWT authentication via the `Authorization: Bearer <token>` header.

---

## Table of Contents

1. [Assignment CRUD Operations](#assignment-crud-operations)
2. [Assignment File Upload (Admin)](#assignment-file-upload-admin)
3. [Assignment Attempts (Students)](#assignment-attempts-students)
4. [Assignment Attempt File Upload (Students)](#assignment-attempt-file-upload-students)
5. [Scoring Attempts (Admin)](#scoring-attempts-admin)

---

## Assignment CRUD Operations

### 1. Create Assignment (Admin Only)

**Endpoint**: `POST /assignments`

**Description**: Create a new assignment for a room. Only room admin can create assignments.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "roomId": "uuid-of-room",
  "title": "Assignment Title",
  "description": "Assignment description and instructions",
  "assignmentUrl": "https://s3.amazonaws.com/bucket/assignment-files/room-id/file.pdf",
  "startAt": "2024-01-15T00:00:00Z",
  "endAt": "2024-01-30T23:59:59Z",
  "isTurnInLateEnabled": true
}
```

**Field Descriptions**:
- `roomId` (required): UUID of the room
- `title` (required): Assignment title (max 255 characters)
- `description` (required): Assignment instructions
- `assignmentUrl` (required): S3 URL of the assignment document (obtained via presigned URL upload)
- `startAt` (optional): Assignment start date (ISO 8601 format)
- `endAt` (optional): Assignment deadline (ISO 8601 format)
- `isTurnInLateEnabled` (optional): Allow late submissions (default: false)

**Success Response** (201 Created):
```json
{
  "id": "uuid",
  "title": "Assignment Title",
  "description": "Assignment description",
  "assignmentUrl": "https://s3.amazonaws.com/...",
  "startAt": "2024-01-15T00:00:00.000Z",
  "endAt": "2024-01-30T23:59:59.000Z",
  "isTurnInLateEnabled": true,
  "createdAt": "2024-01-10T10:00:00.000Z",
  "room": {
    "id": "uuid",
    "title": "Room Name"
  },
  "author": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "image": "profile-url"
  }
}
```

**Error Responses**:
- `404 Not Found`: Room not found
- `403 Forbidden`: Only room admin can create assignments

---

### 2. Get All Assignments

**Endpoint**: `GET /assignments`

**Description**: Get all assignments with pagination, filtering, and search. Filtered by roomId if provided.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
```

**Query Parameters**:
```
page=1
limit=10
sortBy=createdAt
sortOrder=DESC
search=math
roomId=uuid-of-room
```

**Parameter Descriptions**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `sortBy` (optional): Sort field - `createdAt`, `title`, `startAt`, `endAt` (default: `createdAt`)
- `sortOrder` (optional): `ASC` or `DESC` (default: `DESC`)
- `search` (optional): Search in title and description
- `roomId` (optional): Filter by room ID

**Success Response** (200 OK):
```json
{
  "assignments": [
    {
      "id": "uuid",
      "title": "Assignment Title",
      "description": "Description",
      "assignmentUrl": "https://s3.amazonaws.com/...",
      "startAt": "2024-01-15T00:00:00.000Z",
      "endAt": "2024-01-30T23:59:59.000Z",
      "isTurnInLateEnabled": true,
      "createdAt": "2024-01-10T10:00:00.000Z",
      "room": {
        "id": "uuid",
        "title": "Room Name"
      },
      "author": {
        "id": "uuid",
        "firstName": "John",
        "lastName": "Doe",
        "email": "john@example.com",
        "image": "profile-url"
      }
    }
  ],
  "total": 25,
  "totalPages": 3,
  "currentPage": 1
}
```

**Error Responses**:
- `403 Forbidden`: User does not have access to the specified room

---

### 3. Get Single Assignment

**Endpoint**: `GET /assignments/:id`

**Description**: Get assignment details by ID. User must have access to the room.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
```

**URL Parameters**:
- `id`: Assignment UUID

**Success Response** (200 OK):
```json
{
  "id": "uuid",
  "title": "Assignment Title",
  "description": "Description",
  "assignmentUrl": "https://s3.amazonaws.com/...",
  "startAt": "2024-01-15T00:00:00.000Z",
  "endAt": "2024-01-30T23:59:59.000Z",
  "isTurnInLateEnabled": true,
  "createdAt": "2024-01-10T10:00:00.000Z",
  "room": {
    "id": "uuid",
    "title": "Room Name"
  },
  "author": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "image": "profile-url"
  }
}
```

**Error Responses**:
- `404 Not Found`: Assignment not found
- `403 Forbidden`: User does not have access to this assignment

---

### 4. Update Assignment (Admin Only)

**Endpoint**: `PATCH /assignments/:id`

**Description**: Update assignment details. Only room admin can update.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**URL Parameters**:
- `id`: Assignment UUID

**Request Body** (all fields optional):
```json
{
  "title": "Updated Title",
  "description": "Updated description",
  "assignmentUrl": "https://s3.amazonaws.com/new-file.pdf",
  "startAt": "2024-01-20T00:00:00Z",
  "endAt": "2024-02-05T23:59:59Z",
  "isTurnInLateEnabled": false
}
```

**Success Response** (200 OK):
```json
{
  "id": "uuid",
  "title": "Updated Title",
  "description": "Updated description",
  "assignmentUrl": "https://s3.amazonaws.com/new-file.pdf",
  "startAt": "2024-01-20T00:00:00.000Z",
  "endAt": "2024-02-05T23:59:59.000Z",
  "isTurnInLateEnabled": false,
  "createdAt": "2024-01-10T10:00:00.000Z",
  "room": {
    "id": "uuid",
    "title": "Room Name"
  },
  "author": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "image": "profile-url"
  }
}
```

**Error Responses**:
- `404 Not Found`: Assignment not found
- `403 Forbidden`: Only room admin can update assignments

---

### 5. Delete Assignment (Admin Only)

**Endpoint**: `DELETE /assignments/:id`

**Description**: Delete an assignment. Only room admin can delete.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
```

**URL Parameters**:
- `id`: Assignment UUID

**Success Response** (200 OK):
```json
{
  "message": "Assignment deleted successfully"
}
```

**Error Responses**:
- `404 Not Found`: Assignment not found
- `403 Forbidden`: Only room admin can delete assignments

---

## Assignment File Upload (Admin)

### 6. Generate Presigned URL for Assignment File

**Endpoint**: `POST /files/presigned-url/assignment/:roomId`

**Description**: Generate a presigned URL for uploading an assignment file to S3. Only room admin can upload assignment files.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**URL Parameters**:
- `roomId`: Room UUID

**Request Body**:
```json
{
  "originalName": "assignment-document.pdf",
  "contentType": "application/pdf",
  "size": 2048576
}
```

**Field Descriptions**:
- `originalName` (required): Original filename
- `contentType` (required): MIME type
- `size` (required): File size in bytes (max 50MB)

**Success Response** (200 OK):
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...?signature=...",
  "fileKey": "assignment-files/room-uuid/unique-filename.pdf",
  "fileUrl": "https://s3.amazonaws.com/.../assignment-files/room-uuid/unique-filename.pdf",
  "metadata": {
    "originalName": "assignment-document.pdf",
    "contentType": "application/pdf",
    "size": 2048576,
    "roomId": "uuid"
  }
}
```

**Upload Process**:
1. Call this endpoint to get `uploadUrl`
2. Upload file directly to S3 using `uploadUrl` (PUT request)
3. Use `fileUrl` when creating the assignment

**Error Responses**:
- `400 Bad Request`: File size exceeds 50MB limit
- `404 Not Found`: Room not found
- `403 Forbidden`: Only room admin can upload assignment files

---

## Assignment Attempts (Students)

### 7. Submit Assignment Attempt

**Endpoint**: `POST /assignments/attempts`

**Description**: Submit an attempt for an assignment. Room members can submit once per assignment.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "assignmentId": "uuid-of-assignment",
  "fileUrl": "https://s3.amazonaws.com/.../attempt-files/assignment-uuid/submission.pdf"
}
```

**Field Descriptions**:
- `assignmentId` (required): Assignment UUID
- `fileUrl` (required): S3 URL of the submission file (obtained via presigned URL upload)

**Success Response** (201 Created):
```json
{
  "id": "uuid",
  "fileUrl": "https://s3.amazonaws.com/.../submission.pdf",
  "submitAt": "2024-01-25T15:30:00.000Z",
  "score": null,
  "user": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "image": "profile-url"
  },
  "assignment": {
    "id": "uuid",
    "title": "Assignment Title"
  }
}
```

**Error Responses**:
- `404 Not Found`: Assignment not found
- `403 Forbidden`: User does not have access to this assignment
- `400 Bad Request`: 
  - Assignment submission deadline has passed (if late submissions disabled)
  - User has already submitted this assignment

---

### 8. Get All Attempts for Assignment (Admin Only)

**Endpoint**: `GET /assignments/:id/attempts`

**Description**: Get all submission attempts for an assignment. Only room admin can view all attempts.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
```

**URL Parameters**:
- `id`: Assignment UUID

**Success Response** (200 OK):
```json
[
  {
    "id": "uuid",
    "fileUrl": "https://s3.amazonaws.com/.../submission.pdf",
    "submitAt": "2024-01-25T15:30:00.000Z",
    "score": 85,
    "user": {
      "id": "uuid",
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane@example.com",
      "image": "profile-url"
    },
    "assignment": {
      "id": "uuid",
      "title": "Assignment Title"
    }
  },
  {
    "id": "uuid2",
    "fileUrl": "https://s3.amazonaws.com/.../submission2.pdf",
    "submitAt": "2024-01-26T10:15:00.000Z",
    "score": null,
    "user": {
      "id": "uuid2",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "image": "profile-url"
    },
    "assignment": {
      "id": "uuid",
      "title": "Assignment Title"
    }
  }
]
```

**Error Responses**:
- `404 Not Found`: Assignment not found
- `403 Forbidden`: Only room admin can view all attempts

---

### 9. Get My Attempt for Assignment

**Endpoint**: `GET /assignments/:id/my-attempt`

**Description**: Get the current user's submission attempt for an assignment.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
```

**URL Parameters**:
- `id`: Assignment UUID

**Success Response** (200 OK):
```json
{
  "id": "uuid",
  "fileUrl": "https://s3.amazonaws.com/.../submission.pdf",
  "submitAt": "2024-01-25T15:30:00.000Z",
  "score": 85,
  "user": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "image": "profile-url"
  },
  "assignment": {
    "id": "uuid",
    "title": "Assignment Title"
  }
}
```

**If no attempt exists** (200 OK):
```json
null
```

**Error Responses**:
- `404 Not Found`: Assignment not found
- `403 Forbidden`: User does not have access to this assignment

---

## Assignment Attempt File Upload (Students)

### 10. Generate Presigned URL for Attempt File

**Endpoint**: `POST /files/presigned-url/attempt/:assignmentId`

**Description**: Generate a presigned URL for uploading a submission file to S3. Room members can upload attempt files.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**URL Parameters**:
- `assignmentId`: Assignment UUID

**Request Body**:
```json
{
  "originalName": "my-submission.pdf",
  "contentType": "application/pdf",
  "size": 1024768
}
```

**Field Descriptions**:
- `originalName` (required): Original filename
- `contentType` (required): MIME type
- `size` (required): File size in bytes (max 50MB)

**Success Response** (200 OK):
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...?signature=...",
  "fileKey": "attempt-files/assignment-uuid/unique-filename.pdf",
  "fileUrl": "https://s3.amazonaws.com/.../attempt-files/assignment-uuid/unique-filename.pdf",
  "metadata": {
    "originalName": "my-submission.pdf",
    "contentType": "application/pdf",
    "size": 1024768
  }
}
```

**Upload Process**:
1. Call this endpoint to get `uploadUrl`
2. Upload file directly to S3 using `uploadUrl` (PUT request)
3. Use `fileUrl` when submitting the attempt

**Error Responses**:
- `400 Bad Request`: File size exceeds 50MB limit
- `404 Not Found`: Assignment not found
- `403 Forbidden`: User does not have access to submit to this assignment

---

## Scoring Attempts (Admin)

### 11. Score Assignment Attempt (Admin Only)

**Endpoint**: `PATCH /assignments/attempts/:attemptId/score`

**Description**: Score a student's assignment attempt. Only room admin can score attempts.

**Request Headers**:
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**URL Parameters**:
- `attemptId`: Attempt UUID

**Request Body**:
```json
{
  "score": 85
}
```

**Field Descriptions**:
- `score` (required): Score value (0-100)

**Success Response** (200 OK):
```json
{
  "id": "uuid",
  "fileUrl": "https://s3.amazonaws.com/.../submission.pdf",
  "submitAt": "2024-01-25T15:30:00.000Z",
  "score": 85,
  "user": {
    "id": "uuid",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane@example.com",
    "image": "profile-url"
  },
  "assignment": {
    "id": "uuid",
    "title": "Assignment Title"
  }
}
```

**Error Responses**:
- `404 Not Found`: Attempt not found
- `403 Forbidden`: Only room admin can score attempts
- `400 Bad Request`: Invalid score (must be 0-100)

---

## Complete Workflow Examples

### Admin Workflow: Create Assignment with File

```bash
# Step 1: Generate presigned URL for assignment file
curl -X POST https://api.example.com/files/presigned-url/assignment/room-uuid \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "originalName": "assignment-1.pdf",
    "contentType": "application/pdf",
    "size": 2048576
  }'

# Response:
# {
#   "uploadUrl": "https://s3.amazonaws.com/...?signature=...",
#   "fileUrl": "https://s3.amazonaws.com/.../assignment-files/room-uuid/assignment-1-xyz.pdf"
# }

# Step 2: Upload file to S3 using uploadUrl
curl -X PUT "https://s3.amazonaws.com/...?signature=..." \
  -H "Content-Type: application/pdf" \
  --data-binary @assignment-1.pdf

# Step 3: Create assignment with fileUrl
curl -X POST https://api.example.com/assignments \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "room-uuid",
    "title": "Math Assignment 1",
    "description": "Complete exercises 1-10",
    "assignmentUrl": "https://s3.amazonaws.com/.../assignment-files/room-uuid/assignment-1-xyz.pdf",
    "startAt": "2024-01-15T00:00:00Z",
    "endAt": "2024-01-30T23:59:59Z",
    "isTurnInLateEnabled": true
  }'
```

### Student Workflow: Submit Assignment Attempt

```bash
# Step 1: Generate presigned URL for submission file
curl -X POST https://api.example.com/files/presigned-url/attempt/assignment-uuid \
  -H "Authorization: Bearer <student-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "originalName": "my-submission.pdf",
    "contentType": "application/pdf",
    "size": 1024768
  }'

# Response:
# {
#   "uploadUrl": "https://s3.amazonaws.com/...?signature=...",
#   "fileUrl": "https://s3.amazonaws.com/.../attempt-files/assignment-uuid/my-submission-abc.pdf"
# }

# Step 2: Upload file to S3 using uploadUrl
curl -X PUT "https://s3.amazonaws.com/...?signature=..." \
  -H "Content-Type: application/pdf" \
  --data-binary @my-submission.pdf

# Step 3: Submit attempt with fileUrl
curl -X POST https://api.example.com/assignments/attempts \
  -H "Authorization: Bearer <student-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "assignmentId": "assignment-uuid",
    "fileUrl": "https://s3.amazonaws.com/.../attempt-files/assignment-uuid/my-submission-abc.pdf"
  }'

# Step 4: Check submission status
curl -X GET https://api.example.com/assignments/assignment-uuid/my-attempt \
  -H "Authorization: Bearer <student-token>"
```

### Admin Workflow: Score Submissions

```bash
# Step 1: Get all attempts for assignment
curl -X GET https://api.example.com/assignments/assignment-uuid/attempts \
  -H "Authorization: Bearer <admin-token>"

# Step 2: Score individual attempt
curl -X PATCH https://api.example.com/assignments/attempts/attempt-uuid/score \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "score": 85
  }'
```

---

## Error Codes Summary

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation errors, late submission, duplicate submission) |
| 401 | Unauthorized (invalid/missing JWT token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found (resource doesn't exist) |
| 500 | Internal Server Error |

---

## Access Control Summary

| Endpoint | Admin | Moderator | Member |
|----------|-------|-----------|--------|
| Create Assignment | ✅ | ❌ | ❌ |
| Update Assignment | ✅ | ❌ | ❌ |
| Delete Assignment | ✅ | ❌ | ❌ |
| View Assignments | ✅ | ✅ | ✅ |
| View Single Assignment | ✅ | ✅ | ✅ |
| Upload Assignment File | ✅ | ❌ | ❌ |
| Submit Attempt | ✅ | ✅ | ✅ |
| Upload Attempt File | ✅ | ✅ | ✅ |
| View All Attempts | ✅ | ❌ | ❌ |
| View Own Attempt | ✅ | ✅ | ✅ |
| Score Attempts | ✅ | ❌ | ❌ |

---

## Notes

1. **File Size Limit**: Maximum file size is 50MB for both assignment files and submission files
2. **Presigned URL Expiry**: Upload URLs expire in 5 minutes
3. **Late Submissions**: Controlled by `isTurnInLateEnabled` flag on assignment
4. **One Attempt Per Student**: Students can only submit one attempt per assignment
5. **Score Range**: Scores must be between 0 and 100
6. **S3 Folder Structure**:
   - Assignment files: `assignment-files/{roomId}/`
   - Attempt files: `attempt-files/{assignmentId}/`

---

## Support

For issues or questions, contact the development team or refer to the main API documentation.
