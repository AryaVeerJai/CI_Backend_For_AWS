/**
 * Attach only safe error detail for API clients.
 * In production, internal Error messages are omitted to avoid leaking stack/DB paths.
 */
const clientErrorPayload = (error) => {
  if (!error) {
    return {};
  }
  if (process.env.NODE_ENV === 'production') {
    return {};
  }
  const message = typeof error.message === 'string' ? error.message : String(error);
  return { error: message };
};

module.exports = {
  clientErrorPayload
};
