import axios from 'axios';
import { UserAnalysis } from '../models/UserAnalysis';

export const startGithubAnalysis = async (githubId: string) => {
  try {
    const user = await UserAnalysis.findOne({ githubId });
    if (!user) return;

    user.status = 'processing';
    await user.save();

    const accessToken = user.accessToken;

    // 1. Fetch repositories
    const reposResponse = await axios.get('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const reposData = reposResponse.data;
    const formattedRepos = reposData.map((repo: any) => ({
      name: repo.name,
      description: repo.description || '',
      language: repo.language || 'Unknown',
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      url: repo.html_url,
    }));

    user.repositories = formattedRepos;

    // 2. Simple Evaluation Logic
    // Count total stars, forks, and find top languages
    let totalStars = 0;
    let totalForks = 0;
    const languageCounts: Record<string, number> = {};

    formattedRepos.forEach((repo: any) => {
      totalStars += repo.stars;
      totalForks += repo.forks;
      if (repo.language && repo.language !== 'Unknown') {
        languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
      }
    });

    // Find the most used language
    let primaryLanguage = 'Unknown';
    let maxCount = 0;
    for (const [lang, count] of Object.entries(languageCounts)) {
      if (count > maxCount) {
        maxCount = count;
        primaryLanguage = lang;
      }
    }

    // Generate a basic "judgment" score and message
    let score = 0;
    score += Math.min(totalStars * 2, 50); // Up to 50 points for stars
    score += Math.min(formattedRepos.length, 30); // Up to 30 points for repo count
    score += Math.min(Object.keys(languageCounts).length * 5, 20); // Up to 20 points for language diversity

    const evaluation = {
      totalStars,
      totalForks,
      totalRepositories: formattedRepos.length,
      primaryLanguage,
      languageDiversity: Object.keys(languageCounts).length,
      score,
      judgmentMessage: `This user has a score of ${score}/100. They primarily write in ${primaryLanguage} and have ${totalStars} total stars across their repositories.`,
    };

    user.evaluation = evaluation;
    user.status = 'completed';
    await user.save();

  } catch (error) {
    console.error(`Error analyzing GitHub user ${githubId}:`, error);
    const user = await UserAnalysis.findOne({ githubId });
    if (user) {
      user.status = 'failed';
      await user.save();
    }
  }
};
