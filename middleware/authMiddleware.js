const jwt = require('jsonwebtoken');

const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
      console.log('Missing Authorization header');
      return res.status(401).json({ msg: 'Access denied - No authorization header' });
    }
    
    // Extract the token from "Bearer <token>" format
    const [bearer, token] = authHeader.split(' ');
    
    if (!bearer || !token || bearer !== 'Bearer') {
      console.log('Invalid Authorization header format');
      return res.status(401).json({ msg: 'Access denied - Invalid authorization format' });
    }
    
    // Verify the JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ msg: 'Token expired' });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ msg: 'Invalid token' });
      }
      throw err;
    }
    
    // Verify admin role
    if (!decoded.role || decoded.role !== 'admin') {
      console.log('Invalid role in token:', decoded.role);
      return res.status(403).json({ msg: 'Forbidden - Insufficient privileges' });
    }
    
    // Make sure username exists in payload
    if (!decoded.username) {
      console.log('Missing username in token payload');
      return res.status(401).json({ msg: 'Invalid token structure' });
    }
    
    // Add user info to request
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Error in admin verification:', err);
    res.status(500).json({ msg: 'Internal server error during authentication' });
  }
};

module.exports = { verifyAdmin };