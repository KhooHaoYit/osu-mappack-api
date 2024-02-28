import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from 'nestjs-prisma';
import { DiscordBotService } from './app.discord-bot';
import { DiscordCdnModule } from './discord-cdn/discord-cdn.module';
import { ConfigModule } from '@nestjs/config';
import discordCdnConfig from './discord-cdn/discord-cdn.config';

@Module({
  imports: [
    PrismaModule.forRoot({
      isGlobal: true,
    }),
    ConfigModule.forRoot({
      load: [discordCdnConfig],
    }),
    DiscordCdnModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    DiscordBotService,
  ],
})
export class AppModule { }
