import { Body, Controller, Get, Param, Post, Query, Response } from '@nestjs/common';
import { AppService } from './app.service';
import type { Response as ExpressResponse } from 'express';

@Controller()
export class AppController {

  constructor(
    private readonly appService: AppService,
  ) { }

  @Get('/downloadBeatmapset')
  async downloadLatestBeatmapsets(
    @Response() res: ExpressResponse,
    @Query('beatmapsetId', { transform: value => +value })
    beatmapsetId: number,
    @Query('lastModified', { transform: value => value && new Date(+value) })
    lastModified?: Date,
  ) {
    const [url] = await this.appService.getBeatmapsetDownloadLinks([[beatmapsetId, lastModified]]);
    res
      .redirect(url);
  }

  @Get('/pack')
  async pack(
    @Response() res: ExpressResponse,
    @Query('packId', { transform: value => value ?? '' }) packId: string,
  ) {
    const packInfo = this.appService.getTemporaryPack(packId);
    if (!packInfo)
      throw new Error(`Pack has expired or it's invalid`);
    const [filename, beatmapsetIds] = packInfo;
    const pack = await this.appService.buildPack(beatmapsetIds);
    res
      .set('X-Archive-Files', 'zip')
      .set('Content-Disposition', `attachment; filename=${JSON.stringify(filename)}`)
      .end(pack);
  }

}
