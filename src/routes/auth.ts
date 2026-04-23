import { Router } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { UserAnalysis } from '../models/UserAnalysis';
import { startGithubAnalysis } from '../services/githubAnalysisService';

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || `${APP_BASE_URL}/auth/github/callback`;

const ensureOAuthConfig = () => {
  return Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET && GITHUB_REDIRECT_URI);
};

// 1. Redirect to GitHub
router.get('/github', (req, res) => {
  if (!ensureOAuthConfig()) {
    return res.status(500).json({ error: 'OAuth configuration is missing on the server' });
  }

  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;

  const redirectUri = new URL('https://github.com/login/oauth/authorize');
  redirectUri.searchParams.set('client_id', GITHUB_CLIENT_ID);
  redirectUri.searchParams.set('scope', 'repo read:user');
  redirectUri.searchParams.set('state', state);
  redirectUri.searchParams.set('redirect_uri', GITHUB_REDIRECT_URI);

  res.redirect(redirectUri.toString());
});

// 2. Callback from GitHub
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }
  if (!state || typeof state !== 'string' || state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid OAuth state' });
  }
  req.session.oauthState = undefined;
  if (!ensureOAuthConfig()) {
    return res.status(500).json({ error: 'OAuth configuration is missing on the server' });
  }

  try {
    // Exchange code for token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      },
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      return res.status(400).json({ error: 'Failed to retrieve access token' });
    }

    // Get user info
    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const userData = userResponse.data;
    const githubId = userData.id.toString();
    const username = userData.login;

    // Upsert user in MongoDB
    let user = await UserAnalysis.findOne({ githubId });
    if (!user) {
      user = new UserAnalysis({
        githubId,
        username,
        accessToken,
        status: 'pending',
      });
    } else {
      user.username = username;
      user.accessToken = accessToken;
      user.status = 'pending';
    }
    await user.save();
    req.session.githubId = githubId;

    // Trigger async analysis background task
    startGithubAnalysis(githubId);

    // Redirect to frontend
    res.redirect('/');

  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

export default router;
