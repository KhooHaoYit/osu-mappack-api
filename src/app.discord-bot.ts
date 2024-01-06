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

@Injectable()
export class DiscordBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DiscordBotService.name);

  client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.MessageContent,
      IntentsBitField.Flags.GuildMessageReactions,
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
          [beatmasetId: number, lastModified: Date, Beatmap][],
          [error: any, typeof beatmaps[0]][],
        ]),
      );
      await user.send({
        content: `
Downloaded ${success.length} beatmaps${failed.length ? `, ${failed.length} of which failed to download` : ''}
`,
        components: [
          new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('Download as Pack')
                .setURL('http://google.com')
                .setURL(`${env.REVERSE_PROXY_URL}/pack?filename=${reaction.message.id}.zip&beatmapsetIds=${success
                  .map(([bmsId, lastModified]) => `${bmsId},${lastModified.getTime()}`).join(';')}`)
                .setDisabled(success.length === 0),
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel('Link to Message')
                .setURL(reaction.message.url),
            ),
          ...success.slice(0, 20).map(([beatmapsetId, lastModified, bm]) =>
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel(`${bm.beatmapset_id} ${bm.artist} - ${bm.title}.osz`)
              .setURL(`${env.REVERSE_PROXY_URL}/downloadBeatmapset?beatmapsetId=${beatmapsetId}&lastModified=${lastModified.getTime()}`)
          ).reduce((acc, button) => {
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

    this.client.on('ready', () => this.logger.log(`Logged in as ${this.client.user?.tag}`));
    await this.client.login(env.DISCORD_BOT_TOKEN);
  }

  async onApplicationShutdown(signal?: string | undefined) {
    await this.client.destroy();
  }

}
