-- 20260601000018_card_attachments_more_mimes.sql
-- Slice 1.8f-fix: expand card-attachments bucket to accept the file types
-- WHAstudio actually uses (CAD, office docs, video, archives) in addition
-- to images + PDF. Bump file_size_limit so the big arch PDFs (~50MB) fit.

begin;

update storage.buckets set
  file_size_limit = 104857600,  -- 100 MB (was 20 MB; site videos + big PDFs)
  allowed_mime_types = array[
    -- Images
    'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','image/svg+xml','image/tiff',
    -- Documents
    'application/pdf',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv',
    -- CAD / design
    'application/acad','image/vnd.dwg','application/dxf','image/vnd.dxf',
    'application/vnd.sketchup.skp',
    'application/postscript','application/illustrator',
    -- Video
    'video/mp4','video/quicktime','video/x-msvideo','video/webm',
    -- Audio (site voice notes)
    'audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/ogg',
    -- Archives
    'application/zip','application/vnd.rar','application/x-7z-compressed',
    -- Last-resort fallback so import doesn't get stuck on octet-stream when
    -- the extension is recognized
    'application/octet-stream'
  ]
where id = 'card-attachments';

commit;
