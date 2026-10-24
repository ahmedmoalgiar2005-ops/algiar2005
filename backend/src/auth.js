const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET must be set (32+ characters)');

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

// requireAuth()          -> any logged-in user
// requireAuth('admin')   -> admin only
function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try {
      const payload = jwt.verify(token, SECRET);
      if (role && payload.role !== role) return res.status(403).json({ error: 'forbidden' });
      req.user = payload;
      next();
    } catch (e) {
      res.status(401).json({ error: 'unauthorized' });
    }
  };
}

module.exports = { sign, requireAuth, bcrypt };
