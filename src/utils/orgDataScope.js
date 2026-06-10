/**
 * Organization-scoped data access helpers for operational collections.
 */

const getOrgScope = (req) => ({
  organizationId: req.user?.organizationId || null,
  msmeId: req.user?.msmeId || null,
  enterpriseId: req.user?.enterpriseId || null,
  segment: req.user?.segment || req.user?.role || null
});

const buildOrgDataFilter = (req, extra = {}) => {
  const { organizationId, msmeId } = getOrgScope(req);

  if (organizationId) {
    const orConditions = [{ organizationId }];
    if (msmeId) {
      orConditions.push({
        msmeId,
        $or: [
          { organizationId: { $exists: false } },
          { organizationId: null }
        ]
      });
    }
    return { ...extra, $or: orConditions };
  }

  if (msmeId) {
    return { ...extra, msmeId };
  }

  return { ...extra, _id: null };
};

const withOrgPayload = (req, payload = {}) => {
  const scope = getOrgScope(req);
  const next = { ...payload };

  if (scope.organizationId) {
    next.organizationId = scope.organizationId;
  }
  if (scope.msmeId) {
    next.msmeId = scope.msmeId;
  }

  return next;
};

const mergeOrgFilter = (req, filter = {}) => {
  const orgFilter = buildOrgDataFilter(req);
  if (orgFilter.$or && filter.$or) {
    return { $and: [orgFilter, filter] };
  }
  return { ...orgFilter, ...filter };
};

module.exports = {
  getOrgScope,
  buildOrgDataFilter,
  withOrgPayload,
  mergeOrgFilter
};
