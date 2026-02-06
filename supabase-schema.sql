-- Private Tenders Table
-- Run this SQL in your Supabase SQL Editor to create the necessary table

-- Create the private_tenders table
CREATE TABLE IF NOT EXISTS public.private_tenders (
    id BIGSERIAL PRIMARY KEY,
    ocid TEXT UNIQUE NOT NULL,
    date TIMESTAMPTZ,
    tag TEXT[],
    initiation_type TEXT,
    
    -- Tender details
    tender_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    value NUMERIC,
    currency TEXT DEFAULT 'ZAR',
    procurement_method TEXT,
    procurement_method_details TEXT,
    main_procurement_category TEXT,
    category TEXT,
    province TEXT,
    
    -- Tender period
    tender_period_start TIMESTAMPTZ,
    tender_period_end TIMESTAMPTZ,
    
    -- Procuring entity
    procuring_entity TEXT,
    procuring_entity_id TEXT,
    
    -- Buyer
    buyer_name TEXT,
    buyer_id TEXT,
    
    -- Documents (stored as JSONB array)
    documents JSONB DEFAULT '[]'::jsonb,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_private_tenders_ocid ON public.private_tenders(ocid);
CREATE INDEX IF NOT EXISTS idx_private_tenders_status ON public.private_tenders(status);
CREATE INDEX IF NOT EXISTS idx_private_tenders_province ON public.private_tenders(province);
CREATE INDEX IF NOT EXISTS idx_private_tenders_category ON public.private_tenders(category);
CREATE INDEX IF NOT EXISTS idx_private_tenders_created_at ON public.private_tenders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_tenders_closing_date ON public.private_tenders(tender_period_end);

-- Create a full-text search index for better search performance
CREATE INDEX IF NOT EXISTS idx_private_tenders_search 
ON public.private_tenders 
USING GIN (to_tsvector('english', 
    COALESCE(title, '') || ' ' || 
    COALESCE(description, '') || ' ' || 
    COALESCE(buyer_name, '') || ' ' || 
    COALESCE(procuring_entity, '')
));

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_private_tenders_updated_at 
    BEFORE UPDATE ON public.private_tenders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE public.private_tenders ENABLE ROW LEVEL SECURITY;

-- Create policies for Row Level Security
-- For now, allow all operations (you can customize this based on your auth setup)

-- Policy: Allow anyone to read private tenders
CREATE POLICY "Allow public read access" 
ON public.private_tenders 
FOR SELECT 
USING (true);

-- Policy: Allow anyone to insert private tenders
-- TODO: Update this to check for authenticated users once auth is implemented
CREATE POLICY "Allow public insert access" 
ON public.private_tenders 
FOR INSERT 
WITH CHECK (true);

-- Policy: Allow anyone to update private tenders
-- TODO: Update this to check for authenticated users once auth is implemented
CREATE POLICY "Allow public update access" 
ON public.private_tenders 
FOR UPDATE 
USING (true);

-- Policy: Allow anyone to delete private tenders
-- TODO: Update this to check for authenticated users once auth is implemented
CREATE POLICY "Allow public delete access" 
ON public.private_tenders 
FOR DELETE 
USING (true);

-- Optional: Add comments for documentation
COMMENT ON TABLE public.private_tenders IS 'Stores private sector tender opportunities posted by users';
COMMENT ON COLUMN public.private_tenders.ocid IS 'Open Contracting Data Standard (OCDS) identifier';
COMMENT ON COLUMN public.private_tenders.documents IS 'Array of tender documents stored as JSONB';

-- Create a view for active tenders (optional)
CREATE OR REPLACE VIEW public.active_private_tenders AS
SELECT *
FROM public.private_tenders
WHERE status = 'active'
  AND (tender_period_end IS NULL OR tender_period_end >= NOW())
ORDER BY created_at DESC;

COMMENT ON VIEW public.active_private_tenders IS 'View of currently active private tenders';
