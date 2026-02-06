import { createClient } from '@supabase/supabase-js';

// Get Supabase credentials from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env file.');
}

// Create Supabase client
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public'
  }
});

/**
 * Database helper functions for private tenders
 */

/**
 * Fetch all private tenders from Supabase
 * @returns {Promise<Array>} Array of tender objects
 */
export const fetchPrivateTenders = async () => {
  try {
    const { data, error } = await supabase
      .from('private_tenders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Transform data back to OCDS format
    return data.map(row => ({
      ocid: row.ocid,
      id: row.id,
      date: row.date,
      tag: row.tag || ['tender'],
      initiationType: row.initiation_type || 'tender',
      tender: {
        id: row.tender_id,
        title: row.title,
        description: row.description,
        status: row.status,
        value: row.value ? {
          amount: row.value,
          currency: row.currency || 'ZAR'
        } : null,
        procurementMethod: row.procurement_method,
        procurementMethodDetails: row.procurement_method_details,
        mainProcurementCategory: row.main_procurement_category,
        category: row.category,
        province: row.province,
        tenderPeriod: {
          startDate: row.tender_period_start,
          endDate: row.tender_period_end
        },
        procuringEntity: row.procuring_entity ? {
          name: row.procuring_entity,
          id: row.procuring_entity_id
        } : null,
        documents: row.documents || []
      },
      buyer: row.buyer_name ? {
        name: row.buyer_name,
        id: row.buyer_id
      } : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  } catch (error) {
    console.error('Error fetching private tenders from Supabase:', error);
    throw error;
  }
};

/**
 * Add a new private tender to Supabase
 * @param {Object} tender - Tender object in OCDS format
 * @returns {Promise<Object>} Created tender
 */
export const addPrivateTender = async (tender) => {
  try {
    // Transform OCDS format to flat database structure
    const dbTender = {
      ocid: tender.ocid,
      date: tender.date,
      tag: tender.tag,
      initiation_type: tender.initiationType,
      tender_id: tender.tender?.id,
      title: tender.tender?.title,
      description: tender.tender?.description,
      status: tender.tender?.status,
      value: tender.tender?.value?.amount,
      currency: tender.tender?.value?.currency || 'ZAR',
      procurement_method: tender.tender?.procurementMethod,
      procurement_method_details: tender.tender?.procurementMethodDetails,
      main_procurement_category: tender.tender?.mainProcurementCategory,
      category: tender.tender?.category,
      province: tender.tender?.province,
      tender_period_start: tender.tender?.tenderPeriod?.startDate,
      tender_period_end: tender.tender?.tenderPeriod?.endDate,
      procuring_entity: tender.tender?.procuringEntity?.name,
      procuring_entity_id: tender.tender?.procuringEntity?.id,
      buyer_name: tender.buyer?.name,
      buyer_id: tender.buyer?.id,
      documents: tender.tender?.documents || []
    };

    const { data, error } = await supabase
      .from('private_tenders')
      .insert([dbTender])
      .select()
      .single();

    if (error) throw error;
    
    // Transform back to OCDS format
    return {
      ocid: data.ocid,
      id: data.id,
      date: data.date,
      tag: data.tag || ['tender'],
      initiationType: data.initiation_type || 'tender',
      tender: {
        id: data.tender_id,
        title: data.title,
        description: data.description,
        status: data.status,
        value: data.value ? {
          amount: data.value,
          currency: data.currency || 'ZAR'
        } : null,
        procurementMethod: data.procurement_method,
        procurementMethodDetails: data.procurement_method_details,
        mainProcurementCategory: data.main_procurement_category,
        category: data.category,
        province: data.province,
        tenderPeriod: {
          startDate: data.tender_period_start,
          endDate: data.tender_period_end
        },
        procuringEntity: data.procuring_entity ? {
          name: data.procuring_entity,
          id: data.procuring_entity_id
        } : null,
        documents: data.documents || []
      },
      buyer: data.buyer_name ? {
        name: data.buyer_name,
        id: data.buyer_id
      } : null,
      created_at: data.created_at,
      updated_at: data.updated_at
    };
  } catch (error) {
    console.error('Error adding private tender to Supabase:', error);
    throw error;
  }
};

/**
 * Update an existing private tender in Supabase
 * @param {string} ocid - Tender OCID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated tender
 */
export const updatePrivateTender = async (ocid, updates) => {
  try {
    // Transform updates to database format
    const dbUpdates = {};
    
    if (updates.tender) {
      if (updates.tender.title !== undefined) dbUpdates.title = updates.tender.title;
      if (updates.tender.description !== undefined) dbUpdates.description = updates.tender.description;
      if (updates.tender.status !== undefined) dbUpdates.status = updates.tender.status;
      if (updates.tender.value?.amount !== undefined) dbUpdates.value = updates.tender.value.amount;
      if (updates.tender.province !== undefined) dbUpdates.province = updates.tender.province;
      if (updates.tender.category !== undefined) dbUpdates.category = updates.tender.category;
      if (updates.tender.tenderPeriod?.endDate !== undefined) {
        dbUpdates.tender_period_end = updates.tender.tenderPeriod.endDate;
      }
    }

    const { data, error } = await supabase
      .from('private_tenders')
      .update(dbUpdates)
      .eq('ocid', ocid)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating private tender in Supabase:', error);
    throw error;
  }
};

/**
 * Delete a private tender from Supabase
 * Also deletes all associated files from Supabase Storage
 * @param {string} ocid - Tender OCID
 * @returns {Promise<void>}
 */
export const deletePrivateTender = async (ocid) => {
  try {
    // First, delete all associated files from storage
    try {
      await deleteTenderDocuments(ocid);
      console.log(`Deleted files for tender: ${ocid}`);
    } catch (storageError) {
      // Log but don't fail if storage deletion fails (files might not exist)
      console.warn(`Could not delete files for tender ${ocid}:`, storageError.message);
    }

    // Then delete the tender record from database
    const { error } = await supabase
      .from('private_tenders')
      .delete()
      .eq('ocid', ocid);

    if (error) throw error;
    
    console.log(`Successfully deleted tender and files: ${ocid}`);
  } catch (error) {
    console.error('Error deleting private tender from Supabase:', error);
    throw error;
  }
};

/**
 * Sync localStorage data to Supabase (for initial migration)
 * @param {Array} localTenders - Tenders from localStorage
 * @returns {Promise<void>}
 */
export const syncLocalStorageToSupabase = async (localTenders) => {
  try {
    if (!Array.isArray(localTenders) || localTenders.length === 0) {
      return;
    }

    // Check which tenders already exist in Supabase
    const { data: existing } = await supabase
      .from('private_tenders')
      .select('ocid');

    const existingOcids = new Set(existing?.map(t => t.ocid) || []);
    
    // Filter out tenders that already exist
    const newTenders = localTenders.filter(t => !existingOcids.has(t.ocid));
    
    if (newTenders.length === 0) {
      console.log('No new tenders to sync');
      return;
    }

    // Transform and insert new tenders
    const dbTenders = newTenders.map(tender => ({
      ocid: tender.ocid,
      date: tender.date,
      tag: tender.tag,
      initiation_type: tender.initiationType,
      tender_id: tender.tender?.id,
      title: tender.tender?.title,
      description: tender.tender?.description,
      status: tender.tender?.status,
      value: tender.tender?.value?.amount,
      currency: tender.tender?.value?.currency || 'ZAR',
      procurement_method: tender.tender?.procurementMethod,
      procurement_method_details: tender.tender?.procurementMethodDetails,
      main_procurement_category: tender.tender?.mainProcurementCategory,
      category: tender.tender?.category,
      province: tender.tender?.province,
      tender_period_start: tender.tender?.tenderPeriod?.startDate,
      tender_period_end: tender.tender?.tenderPeriod?.endDate,
      procuring_entity: tender.tender?.procuringEntity?.name,
      procuring_entity_id: tender.tender?.procuringEntity?.id,
      buyer_name: tender.buyer?.name,
      buyer_id: tender.buyer?.id,
      documents: tender.tender?.documents || []
    }));

    const { error } = await supabase
      .from('private_tenders')
      .insert(dbTenders);

    if (error) throw error;
    
    console.log(`Successfully synced ${newTenders.length} tenders to Supabase`);
  } catch (error) {
    console.error('Error syncing localStorage to Supabase:', error);
    throw error;
  }
};

/**
 * SUPABASE STORAGE FUNCTIONS FOR DOCUMENT UPLOADS
 */

const STORAGE_BUCKET = 'tender-documents';

/**
 * Upload a file to Supabase Storage
 * @param {File} file - File object to upload
 * @param {string} tenderOcid - Tender OCID for organizing files
 * @param {Function} onProgress - Optional callback for upload progress
 * @returns {Promise<Object>} Object with publicUrl and path
 */
export const uploadTenderDocument = async (file, tenderOcid, onProgress = null) => {
  try {
    if (!file) {
      throw new Error('No file provided');
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'image/gif'
    ];

    if (!allowedTypes.includes(file.type)) {
      throw new Error('Invalid file type. Please upload PDF, Word, Excel, or image files.');
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
      throw new Error('File size exceeds 10MB limit');
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `${tenderOcid}/${fileName}`;

    // Upload file to Supabase Storage
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return {
      path: filePath,
      publicUrl: urlData.publicUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    };
  } catch (error) {
    console.error('Error uploading file to Supabase Storage:', error);
    throw error;
  }
};

/**
 * Upload multiple files to Supabase Storage
 * @param {FileList|Array<File>} files - Files to upload
 * @param {string} tenderOcid - Tender OCID
 * @param {Function} onProgress - Optional callback for overall progress
 * @returns {Promise<Array>} Array of upload results
 */
export const uploadMultipleTenderDocuments = async (files, tenderOcid, onProgress = null) => {
  try {
    const fileArray = Array.from(files);
    const results = [];
    const total = fileArray.length;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      
      try {
        const result = await uploadTenderDocument(file, tenderOcid);
        results.push({
          success: true,
          fileName: file.name,
          ...result
        });
      } catch (error) {
        results.push({
          success: false,
          fileName: file.name,
          error: error.message
        });
      }

      // Report progress
      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    return results;
  } catch (error) {
    console.error('Error uploading multiple files:', error);
    throw error;
  }
};

/**
 * Delete a document from Supabase Storage
 * @param {string} filePath - Path to the file in storage
 * @returns {Promise<void>}
 */
export const deleteTenderDocument = async (filePath) => {
  try {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([filePath]);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting file from Supabase Storage:', error);
    throw error;
  }
};

/**
 * Delete all documents for a tender
 * @param {string} tenderOcid - Tender OCID
 * @returns {Promise<void>}
 */
export const deleteTenderDocuments = async (tenderOcid) => {
  try {
    // List all files in the tender's folder
    const { data: files, error: listError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(tenderOcid);

    if (listError) throw listError;

    if (files && files.length > 0) {
      // Delete all files
      const filePaths = files.map(file => `${tenderOcid}/${file.name}`);
      const { error: deleteError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(filePaths);

      if (deleteError) throw deleteError;
    }
  } catch (error) {
    console.error('Error deleting tender documents:', error);
    throw error;
  }
};

/**
 * Get file size in human-readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Get file icon based on file type
 * @param {string} fileType - MIME type
 * @returns {string} Bootstrap icon class
 */
export const getFileIcon = (fileType) => {
  if (fileType.includes('pdf')) return 'bi-file-earmark-pdf';
  if (fileType.includes('word')) return 'bi-file-earmark-word';
  if (fileType.includes('excel') || fileType.includes('spreadsheet')) return 'bi-file-earmark-excel';
  if (fileType.includes('image')) return 'bi-file-earmark-image';
  return 'bi-file-earmark-text';
};
