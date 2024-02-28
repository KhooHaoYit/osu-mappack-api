import { Module } from '@nestjs/common';
import { DiscordCdnService } from './discord-cdn.service';
import { ConfigModule } from '@nestjs/config';
import discordCdnConfig from './discord-cdn.config';

@Module({
  imports: [
    ConfigModule.forFeature(discordCdnConfig),
  ],
  providers: [DiscordCdnService],
  exports: [DiscordCdnService],
})
export class DiscordCdnModule { }
