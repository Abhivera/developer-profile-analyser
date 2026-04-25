import { Router, Request, Response, NextFunction } from 'express';
import apicache from 'apicache';
import rateLimit from 'express-rate-limit';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { fetchLeetCodeUserDetails } from '../services/leetcodeService';

const router = Router();
const cache = apicache.middleware;

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many request from this IP, try again in 1 hour',
});

// Swagger setup
const SPEC_PATH = path.resolve(process.cwd(), 'swagger.yaml');

router.get('/openapi.yaml', (_req, res) => {
  res.setHeader('Content-Type', 'text/yaml');
  res.sendFile(SPEC_PATH);
});

router.use('/api-docs', swaggerUi.serve);
router.get(
  '/api-docs',
  swaggerUi.setup(undefined, {
    swaggerUrl: '/leetcode/openapi.yaml',
    customSiteTitle: 'Alfa-LeetCode API Docs',
    swaggerOptions: {
      docExpansion: 'list',
      filter: true,
      showRequestDuration: true,
    },
  })
);

router.get('/', (_req, res) => {
  res.json({
    apiOverview:
      'Welcome to the Alfa-Leetcode-API! Alfa-Leetcode-Api is a custom solution born out of the need for a well-documented and detailed LeetCode API.',
    routes: {
      userDetails: {
        description: 'Endpoints for retrieving detailed user profile information on Leetcode.',
        Method: 'GET',
        '/:username/profile': 'Get full profile details',
      },
    },
  });
});

const handleProfileRequest = async (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    if (typeof username !== 'string') {
      res.status(400).json({ error: 'Invalid username' });
      return;
    }
    const data = await fetchLeetCodeUserDetails(username);
    res.json(data);
  } catch (err: any) {
    console.error('LeetCode API Error: ', err);
    res.status(500).json({ error: err.message });
  }
};

router.get('/:username/profile', limiter, cache('5 minutes'), handleProfileRequest);
router.get('/:username/profile/', limiter, cache('5 minutes'), handleProfileRequest);

export default router;
