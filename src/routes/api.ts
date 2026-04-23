import { Router } from 'express';
import { UserAnalysis } from '../models/UserAnalysis';

const router = Router();

router.get('/me', async (req, res) => {
  if (!req.session.githubId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await UserAnalysis.findOne({ githubId: req.session.githubId });
    if (!user) {
      return res.status(404).json({ error: 'User analysis not found' });
    }

    return res.json({
      username: user.username,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/analysis/me', async (req, res) => {
  if (!req.session.githubId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await UserAnalysis.findOne({ githubId: req.session.githubId });

    if (!user) {
      return res.status(404).json({ error: 'User analysis not found' });
    }

    // Return the sanitized user object without the accessToken
    const sanitizedUser = {
      username: user.username,
      status: user.status,
      repositories: user.repositories,
      evaluation: user.evaluation,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    res.json(sanitizedUser);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
