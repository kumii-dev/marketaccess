# Private Tenders Feature

## Overview
The Private Tenders page allows users to manually add and manage tender opportunities that are not available on government platforms. This feature is ideal for tracking private sector tenders, internal opportunities, or invitations that your organization receives directly.

## Features

### 1. **Add Private Tenders**
- Click the "Add Tender" button to open the modal form
- Fill in tender details including:
  - Basic Information (Title, Description, Buyer/Organization)
  - Timeline (Start Date, End Date)
  - Optional: Province, Category, Status
  - Optional: Reference Number (auto-generated if not provided)
  - Optional: Briefing Session details
  - Optional: Multiple document attachments

### 2. **Manage Tenders**
- View all private tenders in a familiar card layout
- Filter and search using the same tools as government tenders
- Delete tenders by hovering over a card and clicking the trash icon
- All data is stored locally in your browser

### 3. **Document Management**
- Add multiple documents to each tender
- Each document requires a title and URL
- Documents are displayed in the same format as government tender documents

### 4. **Briefing Sessions**
- Enable/disable briefing session toggle
- Mark sessions as compulsory or optional
- Specify date and venue

## Navigation
- Access Private Tenders from the sidebar under "Access To Market" tools
- Switch between "Government Tenders" and "Private Tenders" anytime

## Data Storage
- All private tenders are stored in your browser's localStorage
- Data persists between sessions on the same device/browser
- Clearing browser data will remove all private tenders

## Form Validation
The form validates:
- Required fields (Title, Description, Buyer, Start Date, End Date)
- Date logic (End date must be after start date)
- Document inputs (Both title and URL required)
- Briefing date (Must be in the future if enabled)

## API Compatibility
Private tenders use the same data structure as government tenders, ensuring:
- Consistent display in TenderCard component
- Same filtering and sorting capabilities
- Compatible with existing search functionality

## Technical Details
- **Component**: `PrivateTendersPage.jsx`
- **Modal**: `AddTenderModal.jsx`
- **Storage**: Browser localStorage
- **Unique IDs**: Generated using `crypto.randomUUID()`
- **Styling**: Matches Access To Market theme (olive green/lime)

## Future Enhancements
Potential features for future versions:
- Edit existing private tenders
- Export/import tender data
- Cloud storage sync
- Team collaboration features
- Reminder notifications for closing dates
