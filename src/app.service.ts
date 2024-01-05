import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { request } from 'undici';
import { env } from './env';
import { upload } from './attachmentUploader';
import { pipeline } from 'stream/promises';
import { CRC32Stream } from 'crc32-stream';
import { PassThrough } from 'stream';

@Injectable()
export class AppService {

  constructor(
    private readonly prisma: PrismaService,
  ) { }

  async getBeatmapsetDownloadLinks(beatmapsets: [beatmapsetId: number, lastModified?: Date][]) {
    const [latest, specific] = beatmapsets.reduce((acc, bms) => {
      if (bms[1])
        acc[1].push(bms as [beatmapsetId: number, lastModified: Date]);
      else acc[0].push(bms[0]);
      return acc;
    }, [[], []] as [number[], [beatmapsetId: number, lastModified: Date][]]);
    const snapshots = await Promise.all([
      this.prisma.beatmapset.findMany({
        where: {
          id: { in: latest },
        },
        select: {
          snapshots: {
            take: 1,
            orderBy: { lastModified: 'desc' },
          },
        },
      }).then(beatmapsets => beatmapsets.map(bms => bms.snapshots[0])),
      this.prisma.beatmapsetSnapshot.findMany({
        where: {
          OR: specific.map(bms => ({
            beatmapsetId: bms[0],
            lastModified: bms[1],
          })),
        },
      }),
    ]).then(list => list.flat());
    if (snapshots.length !== beatmapsets.length)
      throw new Error(`Expected ${beatmapsets.length} beatmapsets, got ${snapshots.length}`);
    return snapshots.map(snapshot => snapshot.url);
  }

  async buildPack(beatmapsets: [beatmapsetId: number, lastModified?: Date][]) {
    const [latest, specific] = beatmapsets.reduce((acc, bms) => {
      if (bms[1])
        acc[1].push(bms as [beatmapsetId: number, lastModified: Date]);
      else acc[0].push(bms[0]);
      return acc;
    }, [[], []] as [number[], [beatmapsetId: number, lastModified: Date][]]);
    const snapshots = await Promise.all([
      this.prisma.beatmapset.findMany({
        where: {
          id: { in: latest },
        },
        select: {
          snapshots: {
            take: 1,
            orderBy: { lastModified: 'desc' },
          },
        },
      }).then(beatmapsets => beatmapsets.map(bms => bms.snapshots[0])),
      this.prisma.beatmapsetSnapshot.findMany({
        where: {
          OR: specific.map(bms => ({
            beatmapsetId: bms[0],
            lastModified: bms[1],
          })),
        },
      }),
    ]).then(list => list.flat());
    if (snapshots.length !== beatmapsets.length)
      throw new Error(`Expected ${beatmapsets.length} beatmapsets, got ${snapshots.length}`);
    return snapshots.map(snapshot => {
      const downloadUrl = snapshot.url.replace(/^.+?(?=\/attachments)/, '/discord-cdn');
      return `${snapshot.crc32} ${snapshot.size} ${downloadUrl} ${snapshot.filename}`;
    }).join('\n');
  }

  async ensureLatestBeatmapsetDownloaded(
    beatmap: { beatmapsetId?: number, beatmapId?: number },
  ): Promise<[beatmapsetId: number, lastModified: Date, Beatmap]> {
    if (!beatmap.beatmapId && !beatmap.beatmapsetId)
      throw new Error(`Please provide either beatmapsetId or beatmapId`);
    // check if osz has update
    const { body } = await request(
      `https://osu.ppy.sh/api/get_beatmaps`,
      {
        query: {
          ...(beatmap.beatmapId
            ? { b: beatmap.beatmapId }
            : { s: beatmap.beatmapsetId }),
          limit: 1,
          k: env.OSU_API_TOKEN,
        },
      },
    );
    const [data] = await body.json() as [Beatmap] | [];
    if (!data)
      throw new Error(`Beatmap/beatmapset does not exists`);
    const beatmapsetId = +data.beatmapset_id;
    const lastUpdate = new Date(data?.last_update + 'Z');
    const dbBms = await this.prisma.beatmapset.findUnique({
      where: { id: beatmapsetId },
      select: { lastUpdate: true },
    });
    if (lastUpdate.getTime() === dbBms?.lastUpdate.getTime()) {
      const [{ snapshots: [{ lastModified }] }] = await this.prisma.beatmapset.findMany({
        where: { id: beatmapsetId },
        select: {
          snapshots: {
            take: 1,
            orderBy: { lastModified: 'desc' },
            select: {
              lastModified: true,
            },
          },
        },
      });
      return [beatmapsetId, lastModified, data];
    }
    // download osz
    const res = await request(`https://osu.ppy.sh/beatmapsets/${beatmapsetId}/download`, {
      headers: {
        cookie: env.OSU_COOKIE,
        referer: 'https://osu.ppy.sh/beatmapsets',
      },
      maxRedirections: 1,
    });
    if (res.headers['content-type'] !== 'application/x-osu-beatmap-archive')
      throw new Error('Failed to download beatmapset');
    const lastModified = new Date(<string>res.headers['last-modified']);
    const dbBeatmapsetSnapshot = await this.prisma.beatmapsetSnapshot.findUnique({
      where: {
        beatmapsetId_lastModified: {
          beatmapsetId,
          lastModified,
        },
      },
    });
    if (dbBeatmapsetSnapshot) { // osz exists, aborting
      res.body.destroy();
      return [beatmapsetId, lastModified, data];
    }
    const size = +<string>res.headers['content-length'];
    const filename = (<string>res.headers['content-disposition'])
      .replace(/^attachment;filename="|"$/g, '');
    const crc32 = new CRC32Stream;
    const pass = new PassThrough;
    const [attachment] = await Promise.all([
      upload(pass, filename, size),
      pipeline(res.body, crc32, pass),
    ]);
    await this.prisma.beatmapsetSnapshot.create({
      data: {
        lastModified,
        beatmapset: {
          connectOrCreate: {
            where: { id: beatmapsetId },
            create: {
              id: beatmapsetId,
              lastUpdate,
            },
          },
        },
        filename,
        size,
        url: attachment.url,
        crc32: crc32.digest('hex'),
      },
    });
    await this.prisma.beatmapset.update({
      where: { id: beatmapsetId },
      data: { lastUpdate },
    });
    return [beatmapsetId, lastModified, data];
  }

}

export type Beatmap = {
  last_update: string
  beatmapset_id: string
  title: string
  title_unicode: string
  cretor: string
  cretor_id: string
  artist: string
  artist_unicode: string
  version: string
}
