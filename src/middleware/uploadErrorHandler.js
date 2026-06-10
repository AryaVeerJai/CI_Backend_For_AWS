const multer = require('multer');
const uploadLimits = require('../config/uploadLimits');

/**
 * Maps multer and upload validation errors to JSON responses (avoids opaque 500s).
 */
function uploadErrorHandler(err, req, res, next) {
  if (!err) {
    return next();
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `File exceeds the maximum size of ${uploadLimits.maxFileSizeLabel}`,
        code: err.code,
        limitBytes: uploadLimits.maxFileBytes,
      });
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: `Too many files. Maximum ${uploadLimits.bulkMaxFiles} files per bulk upload.`,
        code: err.code,
        limit: uploadLimits.bulkMaxFiles,
      });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected upload field name. Use "document" for single upload or "documents" for bulk.',
        code: err.code,
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || 'Upload rejected',
      code: err.code,
    });
  }

  const message = String(err.message || '');
  if (
    message.includes('Unsupported file type') ||
    message.includes('Unsupported accounting import file type') ||
    message.includes('Only CSV and Excel files are allowed')
  ) {
    return res.status(400).json({
      success: false,
      message,
    });
  }

  return next(err);
}

module.exports = uploadErrorHandler;
