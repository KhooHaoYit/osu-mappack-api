import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  IntentsBitField,
  MessageActionRowComponentBuilder,
  Partials,
} from 'discord.js';
import { env } from './env';
import { AppService, Beatmap } from './app.service';
import { BeatmapsetSnapshot } from '@prisma/client';

@Injectable()
export class DiscordBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DiscordBotService.name);

  client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.MessageContent,
      IntentsBitField.Flags.GuildMessageReactions,
      IntentsBitField.Flags.DirectMessages,
      IntentsBitField.Flags.DirectMessageReactions,
    ],
    partials: [
      Partials.User,
      Partials.Channel,
      Partials.GuildMember,
      Partials.Message,
      Partials.Reaction,
      Partials.GuildScheduledEvent,
      Partials.ThreadMember,
    ],
  });

  constructor(
    private readonly appService: AppService,
  ) { }

  async onApplicationBootstrap() {
    this.client.on('messageCreate', async msg => {
      if (msg.author.bot)
        return;
      const beatmaps = extractBeatmapsFromText(msg.content);
      if (!beatmaps.length)
        return;
      await msg.react('⬇');
    });
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot || user.id === this.client.user?.id)
        return;
      if (reaction.emoji.name !== '⬇')
        return;
      if (reaction.partial)
        await reaction.fetch();
      const beatmaps = extractBeatmapsFromText(reaction.message.content);
      if (!beatmaps.length)
        return;
      const before = Date.now();
      const [success, failed] = await Promise.all(
        beatmaps.map(bm =>
          this.appService.ensureLatestBeatmapsetDownloaded(bm)
            .then(bm => [null, bm] satisfies [any, any])
            .catch((err: Error) => [err, bm] satisfies [any, any])
        )
      ).then(res => res
        .reduce((acc, result) => {
          if (result[0])
            acc[1].push(result);
          else acc[0].push(result[1]);
          return acc;
        }, [[], []] as [
          [BeatmapsetSnapshot, Beatmap][],
          [error: any, typeof beatmaps[0]][],
        ]),
      );
      const after = Date.now();
      const duration = after - before;
      const size = success.reduce((acc, [snapshot]) => acc + snapshot.size, 0);
      const unique = Array.from(
        success.reduce((acc, entry) => {
          acc.set(entry[0].beatmapsetId, entry);
          return acc;
        }, new Map<number, typeof success[0]>)
          .values()
      );
      const packId = this.appService.generateTemporaryPack(
        `${reaction.message.id}.zip`,
        unique.map(([snapshot]) => [snapshot.beatmapsetId, snapshot.lastModified]),
      );
      await user.send({
        content: `
Downloaded ${unique.length} beatmap(s) totaling ${formatBytes(size)} in ${duration / 1_000}s\
${failed.length ? `\n${failed.length} of which failed to download` : ''}\
${unique.length !== success.length ? `\n${success.length - unique.length} of which is duplicated` : ''}\
`,
        components: [
          new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('Download as Pack')
                .setURL(`${env.REVERSE_PROXY_URL}/pack?packId=${packId}`)
                .setDisabled(unique.length === 0),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('Link to Message')
                .setURL(reaction.message.url),
            ),
          ...unique.slice(0, 20)
            .map(([snapshot, bm]) => generateDownloadButton(snapshot, bm))
            .reduce((acc, button) => {
              if (acc.length && acc.at(-1)!.components.length < 5)
                acc.at(-1)!.addComponents(button);
              else
                acc.push(
                  new ActionRowBuilder<MessageActionRowComponentBuilder>()
                    .addComponents(button)
                );
              return acc;
            }, [] as ActionRowBuilder<MessageActionRowComponentBuilder>[]),
        ],
      });
    });

    function extractBeatmapsFromText(text?: string | null) {
      return text
        ?.match(/\bhttps?:\/\/\S+/gi)
        ?.map(urlText => {
          const url = new URL(urlText);
          if (url.host !== 'osu.ppy.sh')
            return;
          const beatmapsetId = url.pathname.match(/(?<=\/(?:beatmapsets|s)\/)\d+/)
          if (beatmapsetId)
            return { beatmapsetId: +beatmapsetId[0] };
          const beatmapId = url.pathname.match(/(?<=\/(?:beatmaps|b)\/)\d+/);
          if (beatmapId)
            return { beatmapId: +beatmapId[0] };
        })
        .filter(bm => bm) as { beatmapsetId?: number, beatmapId?: number }[]
        ?? [];
    }

    function generateDownloadButton(snapshot: BeatmapsetSnapshot, bm: Beatmap) {
      let label = `${bm.beatmapset_id} ${bm.artist} - ${bm.title}.osz`;
      if (label.length > 80)
        label = label.substring(0, 80 - 3) + '...';
      return new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(label)
        .setURL(`${env.REVERSE_PROXY_URL}/downloadBeatmapset?beatmapsetId=${snapshot.beatmapsetId}&lastModified=${snapshot.lastModified.getTime()}`);
    }

    function formatBytes(size: number) {
      const increment = 1024;
      if (size <= increment) return `${size}B`;
      size /= increment;
      if (size <= increment) return `${Math.round(size * 1000) / 1000}KiB`;
      size /= increment;
      if (size <= increment) return `${Math.round(size * 1000) / 1000}MiB`;
      size /= increment;
      return `${Math.round(size * 1000) / 1000}GiB`;
    }

    this.client.on('error', err => this.logger.error(err));
    this.client.on('ready', () => this.logger.log(`Logged in as ${this.client.user?.tag}`));
    await this.client.login(env.DISCORD_BOT_TOKEN);
  }

  async onApplicationShutdown(signal?: string | undefined) {
    await this.client.destroy();
  }

}
