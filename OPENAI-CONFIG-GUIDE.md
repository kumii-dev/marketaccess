# OpenAI Service Configuration Guide

## Issue
The OpenAI keyword extraction feature is not working in production (Vercel) because the `VITE_OPENAI_API_KEY` environment variable is not configured.

## Error Message in Console
```
🤖 Starting AI enhancement with keyword-based analysis...
📝 Extracting keywords from bio...
OpenAI API key not configured, skipping keyword extraction
⚠️ No keywords extracted, skipping AI enhancement
```

## Root Cause
- The `.env` file with the OpenAI API key exists locally but is not deployed to Vercel
- Environment variables must be configured separately in Vercel project settings
- The application is gracefully handling the missing key by skipping AI features

## Solution: Configure Environment Variable in Vercel

### Step 1: Access Vercel Dashboard
1. Go to: https://vercel.com/kumii-dev/marketaccess
2. Click on **Settings** tab
3. Navigate to **Environment Variables** section

### Step 2: Add OpenAI API Key
Add a new environment variable with the following details:

**Variable Name:**
```
VITE_OPENAI_API_KEY
```

**Variable Value:** (Your actual OpenAI API key from `.env` file)
```
sk-proj-XXXX...XXXX  (your actual key - do not share publicly)
```

**Environments:** (Select all)
- ✅ Production
- ✅ Preview
- ✅ Development

### Step 3: Redeploy
After adding the environment variable:
1. Go to **Deployments** tab
2. Click on the **latest deployment**
3. Click **⋯ (three dots)** menu
4. Select **Redeploy**
5. Confirm redeployment

**OR** simply push a new commit:
```bash
git commit --allow-empty -m "Trigger redeploy with OpenAI key"
git push origin main
```

## Verification

After redeployment, check the browser console for:

### Expected Success Messages:
```
🤖 Starting AI enhancement with keyword-based analysis...
📝 Extracting keywords from bio...
✅ Extracted keywords: ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
🔍 Analyzing batch 1/9: Top 2 tenders
✅ AI analysis complete for batch 1
```

### What Should Work After Fix:
1. ✅ Keyword extraction from user bio/description
2. ✅ Top 2 tenders analyzed per batch (20 total from 100 tenders)
3. ✅ Extracted keywords displayed in profile summary section
4. ✅ Matched keywords shown in tender cards
5. ✅ AI scores and confidence levels displayed
6. ✅ AI-powered recommendations and concerns

## Alternative Solution: Using Vercel CLI

If you prefer using the command line:

```bash
# Install Vercel CLI (if not already installed)
npm i -g vercel

# Login to Vercel
vercel login

# Add environment variable
vercel env add VITE_OPENAI_API_KEY production preview development

# When prompted, paste your OpenAI API key:
# sk-proj-XXXX...XXXX (your actual key)

# Redeploy
vercel --prod
```

## Security Note

⚠️ **Important:** The OpenAI API key should **NEVER** be committed to Git. It's already in `.gitignore` under `.env` files.

The key is:
- ✅ Stored in local `.env` file (not committed)
- ✅ Configured in Vercel environment variables
- ❌ Never in source code files
- ❌ Never in public repositories

## Cost Management

The current implementation is optimized for cost:
- **Keyword Extraction**: ~100 tokens per session (once per page load)
- **Tender Analysis**: ~400 tokens per tender × 2 tenders per batch × 9 batches = ~7,200 tokens
- **Total per Session**: ~8,300 tokens ≈ $0.018 per user session
- **Model**: GPT-4o-mini (most cost-effective)

If costs become a concern, consider:
1. Increase session cache duration (currently 5 minutes)
2. Reduce number of analyzed tenders per batch (currently 2)
3. Add user-level caching (store keywords per user)

## Testing Locally

The OpenAI service works locally because the `.env` file is present:

```bash
# Start development server
npm run dev

# Check console for AI messages
# You should see keyword extraction and batch analysis
```

## Troubleshooting

### If AI still doesn't work after deployment:

1. **Check Environment Variable is Set:**
   - Go to Vercel Dashboard → Settings → Environment Variables
   - Verify `VITE_OPENAI_API_KEY` is listed and has the correct value

2. **Verify Deployment Used New Environment Variable:**
   - Go to Deployments tab
   - Open latest deployment
   - Check deployment logs for any errors
   - Environment variables are only available to deployments **after** they're added

3. **Check OpenAI API Key is Valid:**
   - Go to https://platform.openai.com/api-keys
   - Verify the key exists and is active
   - Check usage/billing if needed

4. **Clear Browser Cache:**
   - Hard refresh: `Cmd + Shift + R` (Mac) or `Ctrl + Shift + R` (Windows)
   - Or open in incognito/private window

5. **Check Console for Errors:**
   - Look for API key errors: `401 Unauthorized`, `Invalid API key`
   - Look for network errors: API rate limits, timeouts

## Next Steps

After configuring the environment variable:

1. ✅ Add `VITE_OPENAI_API_KEY` to Vercel
2. ✅ Redeploy application
3. ✅ Test in production
4. ✅ Verify keyword extraction works
5. ✅ Verify AI analysis appears in tender cards
6. ✅ Monitor OpenAI usage/costs

## Additional Resources

- **OpenAI API Keys**: https://platform.openai.com/api-keys
- **OpenAI Pricing**: https://openai.com/api/pricing/
- **Vercel Environment Variables**: https://vercel.com/docs/concepts/projects/environment-variables
- **Implementation Documentation**: See `AI-KEYWORD-OPTIMIZATION.md` in the project root

## Questions?

If you have issues after following these steps:
1. Check browser console for error messages
2. Check Vercel deployment logs
3. Verify the API key is correct and active
4. Ensure you redeployed after adding the environment variable
