# Supabase Setup Guide for Private Tenders

This guide will help you set up Supabase to store private sector tenders in the cloud.

## Prerequisites

- A Supabase account (free tier works perfectly)
- Your Market Access project running locally

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Choose your organization
4. Fill in the project details:
   - **Project Name**: `marketaccess` (or your preferred name)
   - **Database Password**: Create a strong password (save it securely)
   - **Region**: Choose the closest region to your users (e.g., South Africa or Europe)
5. Click "Create new project" and wait for it to initialize (~2 minutes)

## Step 2: Create the Database Table

1. In your Supabase project dashboard, click on **SQL Editor** in the left sidebar
2. Click **"+ New query"**
3. Copy the entire contents of `supabase-schema.sql` (in the root of this project)
4. Paste it into the SQL editor
5. Click **"Run"** or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
6. You should see a success message: "Success. No rows returned"

This creates:
- ✅ The `private_tenders` table with all necessary columns
- ✅ Indexes for fast queries
- ✅ Full-text search capabilities
- ✅ Row Level Security policies
- ✅ Automatic timestamp updates

## Step 3: Get Your API Credentials

1. Click on **Settings** (gear icon) in the left sidebar
2. Click on **API** in the settings menu
3. You'll see two important values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (a long string starting with `eyJ...`)
4. Keep this page open - you'll need these values in the next step

## Step 4: Configure Environment Variables

1. In your project root, create a `.env` file (or copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

2. Open the `.env` file and add your Supabase credentials:
   ```bash
   # Existing variables...
   PORT=3001
   VITE_API_BASE_URL=http://localhost:3001
   VITE_USE_MOCK_DATA=false

   # Add these Supabase variables:
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. Replace:
   - `https://your-project-id.supabase.co` with your **Project URL** from Step 3
   - `your-anon-key-here` with your **anon public** key from Step 3

4. Save the file

## Step 5: Restart Your Development Server

1. Stop your current dev server if running (press `Ctrl+C` in the terminal)
2. Restart it:
   ```bash
   npm run dev
   ```

## Step 6: Test the Integration

1. Open your browser and navigate to the Private Tenders page
2. Click **"Add Tender"** and create a test tender
3. The tender should now be saved to Supabase!

### Verify in Supabase:
1. Go back to your Supabase project dashboard
2. Click **"Table Editor"** in the left sidebar
3. Select the `private_tenders` table
4. You should see your test tender in the table!

## Step 7: Migration of Existing Data (Optional)

If you already have tenders saved in localStorage, they will be automatically migrated to Supabase the first time you load the Private Tenders page.

The app will:
1. Check localStorage for existing tenders
2. Sync any new tenders to Supabase
3. Continue using Supabase for all new operations
4. Keep localStorage as a backup in case of network issues

## Features

### What's Working Now:

✅ **Cloud Storage**: All tenders saved to Supabase database
✅ **Real-time Sync**: Changes instantly reflected across devices
✅ **Automatic Backup**: localStorage still used as fallback
✅ **Migration**: Existing localStorage data synced to Supabase
✅ **Error Handling**: Graceful fallback if Supabase is unavailable
✅ **Fast Search**: Full-text search with database indexes
✅ **Secure**: Row Level Security policies enabled

### CRUD Operations:

- ✅ **Create**: Add new private tenders
- ✅ **Read**: Load and display all tenders
- ✅ **Update**: (Ready for future implementation)
- ✅ **Delete**: Remove tenders from database

## Troubleshooting

### Issue: "Missing Supabase environment variables"
**Solution**: Make sure your `.env` file has the correct variables and restart your dev server.

### Issue: Can't connect to Supabase
**Solution**: 
1. Check your internet connection
2. Verify your Supabase project is active in the dashboard
3. Check that your API URL and key are correct
4. The app will fall back to localStorage if Supabase is unavailable

### Issue: Tenders not appearing
**Solution**:
1. Open browser DevTools (F12)
2. Check the Console tab for errors
3. Check the Network tab to see if API calls are failing
4. Verify the table exists in Supabase Table Editor

### Issue: Row Level Security errors
**Solution**: The SQL schema includes policies that allow all operations. If you see RLS errors, make sure you ran the entire `supabase-schema.sql` file.

## Security Considerations

### Current Setup (Development/Demo):
- Anyone can read, create, update, and delete tenders
- This is suitable for internal tools or demos

### Production Recommendations:
1. **Add Authentication**: Implement Supabase Auth to require login
2. **Update RLS Policies**: Modify policies to check for authenticated users:
   ```sql
   -- Example: Only authenticated users can insert
   CREATE POLICY "Authenticated users can insert" 
   ON private_tenders 
   FOR INSERT 
   WITH CHECK (auth.role() = 'authenticated');
   ```
3. **User-Specific Data**: Add a `user_id` column and filter by user
4. **API Key Security**: Never commit your `.env` file to git

## Database Schema Overview

### Table: `private_tenders`

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Auto-incrementing primary key |
| `ocid` | TEXT | Unique tender identifier (OCDS format) |
| `title` | TEXT | Tender title |
| `description` | TEXT | Detailed description |
| `status` | TEXT | Status (active, cancelled, completed) |
| `value` | NUMERIC | Tender value/amount |
| `currency` | TEXT | Currency code (default: ZAR) |
| `province` | TEXT | South African province |
| `category` | TEXT | Procurement category |
| `tender_period_start` | TIMESTAMPTZ | Opening date |
| `tender_period_end` | TIMESTAMPTZ | Closing date |
| `procuring_entity` | TEXT | Organization name |
| `buyer_name` | TEXT | Buyer name |
| `documents` | JSONB | Array of document objects |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Indexes for Performance:
- `ocid` - Fast lookup by tender ID
- `status` - Filter by tender status
- `province` - Filter by location
- `category` - Filter by type
- `created_at` - Sort by newest
- `tender_period_end` - Sort by closing date
- Full-text search on title, description, buyer, entity

## Next Steps

1. ✅ Set up authentication (optional)
2. ✅ Add user-specific tender visibility
3. ✅ Implement tender editing functionality
4. ✅ Add document upload to Supabase Storage
5. ✅ Set up real-time subscriptions for live updates
6. ✅ Deploy to production

## Support

- **Supabase Docs**: [https://supabase.com/docs](https://supabase.com/docs)
- **Supabase Discord**: [https://discord.supabase.com](https://discord.supabase.com)

## Cost Estimate

The **free tier** includes:
- 500MB database space
- 1GB file storage
- 50,000 monthly active users
- Unlimited API requests

This is more than enough for most use cases!

---

**Need help?** Check the Supabase dashboard logs or browser console for detailed error messages.
