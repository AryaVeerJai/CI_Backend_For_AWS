const { resolveAuthorizedMsmeId } = require('./msmeAuthorization');

/**
 * Resolve organization scope for admin vs tenant users.
 */
function resolveAuthorizedOrgScope(req, requestedOrganizationId) {
  const isAdmin = req.user?.role === 'admin';
  const organizationId = req.user?.organizationId ? String(req.user.organizationId) : '';
  const requestedId = requestedOrganizationId ? String(requestedOrganizationId) : '';

  if (isAdmin) {
    if (!requestedId) {
      return { ok: false, status: 400, error: 'Organization ID is required for admin requests' };
    }
    return { ok: true, organizationId: requestedId };
  }

  if (!organizationId) {
    return resolveAuthorizedMsmeId(req, req.user?.msmeId);
  }

  if (requestedId && requestedId !== organizationId) {
    return { ok: false, status: 403, error: 'Access denied for requested organization' };
  }

  return {
    ok: true,
    organizationId,
    msmeId: req.user?.msmeId ? String(req.user.msmeId) : null,
    segment: req.user?.segment || req.user?.role
  };
}

module.exports = { resolveAuthorizedOrgScope };
