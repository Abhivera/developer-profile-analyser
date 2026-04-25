export interface UserProfileResponse {
  matchedUser: {
    submitStats: {
      acSubmissionNum: Array<{ count: number }>;
      totalSubmissionNum: unknown;
    };
    submissionCalendar: string;
    profile: {
      ranking: number;
      reputation: number;
    };
    contributions: {
      points: number;
    };
  };
  allQuestionsCount: Array<{ count: number }>;
  recentSubmissionList: unknown[];
}
