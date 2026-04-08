export interface AuthUserPayload {
  userId: number;
  email: string;
}

export interface AuthTokenResponse {
  token: string;
  user: {
    id: number;
    email: string;
    displayName: string | null;
  };
}
