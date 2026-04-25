import { Router } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { GithubUserAnalysis } from '../models/UserAnalysis';
import { enqueueGithubAnalysis } from '../queue/githubAnalysisQueue';
import { runGithubAnalysisJob } from '../services/githubAnalysisService';

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || `${APP_BASE_URL}/auth/github/callback`;
const OAUTH_STATE_COOKIE = 'oauth_state';
const GITHUB_AUTH_COOKIE = 'github_auth';

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
  res.clearCookie(GITHUB_AUTH_COOKIE);
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 10, // 10 minutes
  });

  const redirectUri = new URL('https://github.com/login/oauth/authorize');
  redirectUri.searchParams.set('client_id', GITHUB_CLIENT_ID);
  redirectUri.searchParams.set('scope', 'repo read:user');
  redirectUri.searchParams.set('state', state);
  redirectUri.searchParams.set('redirect_uri', GITHUB_REDIRECT_URI);

  req.session.save((err) => {
    if (err) {
      console.error('Failed to persist OAuth state in session:', err);
      return res.status(500).json({ error: 'Failed to initialize OAuth session' });
    }
    res.redirect(redirectUri.toString());
  });
});

// 2. Callback from GitHub
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;
  const sessionState = req.session.oauthState;
  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
  const expectedState = typeof sessionState === 'string' ? sessionState : cookieState;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }
  if (!state || typeof state !== 'string' || !expectedState || state !== expectedState) {
    console.error('Invalid OAuth state', {
      hasStateInQuery: Boolean(state),
      hasStateInSession: Boolean(sessionState),
      hasStateInCookie: Boolean(cookieState),
      sessionId: req.sessionID,
      expectedStatePrefix:
        typeof expectedState === 'string'
          ? expectedState.slice(0, 8)
          : null,
      actualStatePrefix: typeof state === 'string' ? state.slice(0, 8) : null,
    });
    return res.status(400).json({
      error: 'Invalid OAuth state',
      message:
        'OAuth session expired or cookie was not preserved. Please start login again from /auth/github.',
    });
  }
  req.session.oauthState = undefined;
  res.clearCookie(OAUTH_STATE_COOKIE);
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
    let user = await GithubUserAnalysis.findOne({ githubId });
    if (!user) {
      user = new GithubUserAnalysis({
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
    res.cookie(GITHUB_AUTH_COOKIE, githubId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });

    try {
      await enqueueGithubAnalysis(githubId);
    } catch (queueError) {
      console.error('Failed to enqueue analysis (is Redis running?). Inline fallback.', queueError);
      void runGithubAnalysisJob(githubId);
    }

    // Persist session before redirect to avoid losing githubId on callback flow.
    req.session.save((sessionErr) => {
      if (sessionErr) {
        console.error('Failed to persist authenticated session:', sessionErr);
        return res.status(500).json({ error: 'Authentication succeeded but session save failed' });
      }
      // Redirect to frontend
      res.redirect('/');
    });

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
    res.clearCookie(GITHUB_AUTH_COOKIE);
    res.clearCookie(OAUTH_STATE_COOKIE);
    res.json({ message: 'Logged out' });
  });
});

export default router;
