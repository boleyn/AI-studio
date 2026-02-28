import jwt, { type JwtPayload } from "jsonwebtoken";

const FALLBACK_SECRET = "dev-auth-secret-change-me";

export type AuthTokenPayload = {
  sub: string;
  username: string;
};

export const getJwtSecret = () => process.env.JWT_SECRET || FALLBACK_SECRET;

export const signAuthToken = (
  payload: AuthTokenPayload,
  expiresIn: jwt.SignOptions["expiresIn"] = "7d"
) =>
  jwt.sign(payload, getJwtSecret(), { expiresIn });

export const verifyAuthToken = (token: string): JwtPayload & AuthTokenPayload => {
  const decoded = jwt.verify(token, getJwtSecret());
  return decoded as JwtPayload & AuthTokenPayload;
};
