# Supabase Storage Troubleshooting Guide

## Upload Error: "Failed to upload: [filename]"

If you're seeing upload failures, follow these steps to diagnose and fix the issue:

### 1. Check Storage Bucket Configuration

1. Go to your Supabase Dashboard: https://njcancswtqnxihxavshl.supabase.co
2. Navigate to **Storage** in the left sidebar
3. Click on the `tender-documents` bucket
4. Click the **⚙️ Settings** icon (gear icon in the top right)

### 2. Verify Bucket Settings

Make sure your bucket has these settings:

#### Public Bucket ✅
- **Public bucket**: Should be **ENABLED/ON**
- This allows files to be accessed via public URLs

#### File Size Limit
- **File size limit**: At least **10MB** (or 10485760 bytes)
- Our app validates 10MB max before upload

### 3. Check Storage Policies (RLS)

1. In the bucket settings, click on **Policies** tab
2. You need policies for:
   - ✅ **INSERT** (upload files)
   - ✅ **SELECT** (read/list files)
   - ✅ **DELETE** (remove files)

#### Quick Fix: Allow All Operations (Development Only)

For **development/testing**, you can add these policies:

**Policy 1: Allow Uploads (INSERT)**
```sql
CREATE POLICY "Allow public uploads"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'tender-documents');
```

**Policy 2: Allow Public Access (SELECT)**
```sql
CREATE POLICY "Allow public access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'tender-documents');
```

**Policy 3: Allow Deletions (DELETE)**
```sql
CREATE POLICY "Allow public deletes"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'tender-documents');
```

#### How to Add Policies:

1. Go to **Storage** → Click `tender-documents` bucket
2. Click **Policies** tab
3. Click **New Policy**
4. Choose **Custom** or use the SQL editor
5. Paste one of the SQL commands above
6. Click **Save**

### 4. CORS Configuration

If uploads still fail, check CORS settings:

1. Go to **Storage** → **Settings**
2. Add your development URL to **Allowed Origins**:
   - `http://localhost:5173`
   - `http://localhost:5174`
   - `*` (wildcard for development - not recommended for production)

### 5. Test the Connection

Open your browser's **Developer Console** (F12 or Cmd+Option+I):

1. Go to **Console** tab
2. Type this and press Enter:
```javascript
await window.supabase.storage.from('tender-documents').list()
```

**Expected result:**
- ✅ Should return an array (even if empty): `{data: [], error: null}`
- ❌ If you see `error: {...}`, there's a permissions issue

### 6. Common Error Codes

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `401` | Unauthorized | Check RLS policies |
| `403` | Forbidden | Enable public bucket or add INSERT policy |
| `404` | Not Found | Bucket doesn't exist - create it |
| `413` | Payload Too Large | File exceeds size limit |
| `new row violates row-level security` | RLS blocking | Add storage policies |

### 7. Browser Console Debugging

Try uploading again and check the console for detailed errors:

1. Open Developer Tools (F12)
2. Go to **Console** tab
3. Click **Upload Files**
4. Look for red error messages

Copy the full error message and check:
- Error code (401, 403, etc.)
- Error message (describes the issue)
- Stack trace (shows where it failed)

### 8. Quick Test: Temporary Workaround

If you need to test immediately, you can temporarily:

1. Make bucket **PUBLIC** (toggle in bucket settings)
2. Disable RLS for testing (not recommended for production):
   ```sql
   ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
   ```

**⚠️ WARNING**: Re-enable RLS before going to production!

### 9. Production-Ready Setup

For production, use authenticated uploads:

```sql
-- Only allow uploads for authenticated users
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tender-documents');

-- Only allow users to delete their own files
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'tender-documents' AND owner = auth.uid());
```

### 10. Still Having Issues?

1. **Check bucket exists**: Storage → Should see `tender-documents`
2. **Check network**: Look at Network tab in DevTools for failed requests
3. **Check file name**: Special characters might cause issues
4. **Try different file**: Test with a simple PDF < 1MB

---

## Need More Help?

If you're still having issues after checking all the above:

1. Open browser console (F12)
2. Try uploading the file
3. Copy the **full error message** from the console
4. Share the error message for more specific help

The error message will tell us exactly what's wrong! 🔍
