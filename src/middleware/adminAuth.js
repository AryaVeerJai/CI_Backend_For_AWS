/**
 * Middleware to verify that the authenticated user has admin privileges
 * Must be used after the auth middleware
 */
const adminAuth = (req, res, next) => {
    // Check if user is authenticated (should be set by auth middleware)
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }

    // Check if user has admin role
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin privileges required.'
        });
    }

    // User is admin, proceed to next middleware/route handler
    next();
};

module.exports = adminAuth;
