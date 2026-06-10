/**
 * Resolve which MSME ID a request may operate on.
 * Admins may target an explicit MSME; other roles are bound to req.user.msmeId.
 */
function resolveAuthorizedMsmeId(req, requestedMsmeId) {
  const userMsmeId = req.user?.msmeId ? String(req.user.msmeId) : '';
  const requestedId = requestedMsmeId ? String(requestedMsmeId) : '';
  const isAdmin = req.user?.role === 'admin';

  if (isAdmin) {
    if (!requestedId) {
      return { ok: false, status: 400, error: 'MSME ID is required for admin requests' };
    }
    return { ok: true, msmeId: requestedId };
  }

  if (!userMsmeId) {
    return { ok: false, status: 404, error: 'MSME profile not found for current user' };
  }

  if (requestedId && requestedId !== userMsmeId) {
    return { ok: false, status: 403, error: 'Access denied for requested MSME ID' };
  }

  return { ok: true, msmeId: userMsmeId };
}

module.exports = { resolveAuthorizedMsmeId };
