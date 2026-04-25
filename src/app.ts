import 'dotenv/config';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import authRoutes from './routes/auth';
import apiRoutes from './routes/api';
import leetcodeRoutes from './routes/leetcode';

const app = express();
// Required when running behind reverse proxies/CDNs (Cloudflare, Nginx, Azure, etc.)
// so secure session cookies are handled correctly.
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24,
    },
    proxy: true,
  })
);

// Fallback: if session lost but auth cookie exists, rehydrate githubId.
app.use((req, _res, next) => {
  const cookieGithubId = req.cookies?.github_auth;
  if (!req.session.githubId && typeof cookieGithubId === 'string' && cookieGithubId.trim()) {
    req.session.githubId = cookieGithubId.trim();
  }
  next();
});

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/leetcode', leetcodeRoutes);

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

export default app;
