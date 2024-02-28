import { registerAs } from '@nestjs/config';
import { env } from 'src/env';

export default registerAs('discord-cdn',() => ({
  url: env.DISCORD_CDN_URL,
  userId: env.DISCORD_CDN_USER_ID,
  userSecret: env.DISCORD_CDN_USER_SECRET,
}));
