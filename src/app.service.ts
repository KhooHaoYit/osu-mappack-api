import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { request } from 'undici';
import { env } from './env';
import { upload } from './attachmentUploader';
import { pipeline } from 'stream/promises';
import { CRC32Stream } from 'crc32-stream';
import { PassThrough } from 'stream';
import { BeatmapsetSnapshot } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class AppService {

  constructor(
    private readonly prisma: PrismaService,
  ) { }

  packInfos = new Map<string, [filename: string, [beatmapsetId: number, lastModified?: Date][]]>;
  generateTemporaryPack(filename: string, beatmapsets: [beatmapsetId: number, lastModified?: Date][]) {
    if (!beatmapsets.length)
      return '';
    const packId = randomUUID();
    this.packInfos.set(packId, [filename, beatmapsets]);
    setTimeout(() => this.packInfos.delete(packId), 1_000 * 60 * 15);
    return packId;
  }
  getTemporaryPack(packId: string) {
    return this.packInfos.get(packId);
  }

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
  ): Promise<[BeatmapsetSnapshot, Beatmap]> {
    if (!beatmap.beatmapId && !beatmap.beatmapsetId)
      throw new Error(`Please provide either beatmapsetId or beatmapId`);
    // check if osz has update
    const { body } = await this.#getBeatmap(beatmap);
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
      const [{ snapshots: [snapshot] }] = await this.prisma.beatmapset.findMany({
        where: { id: beatmapsetId },
        select: {
          snapshots: {
            take: 1,
            orderBy: { lastModified: 'desc' },
          },
        },
      });
      return [snapshot, data];
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
      const [{ snapshots: [snapshot] }] = await this.prisma.beatmapset.findMany({
        where: { id: beatmapsetId },
        select: {
          snapshots: {
            take: 1,
            orderBy: { lastModified: 'desc' },
          },
        },
      });
      return [snapshot, data];
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
    const snapshot = await this.prisma.beatmapsetSnapshot.create({
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
    return [snapshot, data];
  }

  getBeatmapLock = Promise.resolve();
  async #getBeatmap(
    beatmap: { beatmapsetId?: number, beatmapId?: number },
  ) {
    const currentLock = this.getBeatmapLock;
    let resolve: () => void;
    this.getBeatmapLock = new Promise(rs => resolve = rs);
    await currentLock;
    setTimeout(() => resolve(), 100);
    return await request(
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
