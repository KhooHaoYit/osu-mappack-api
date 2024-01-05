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
    @Query('filename', { transform: value => value ?? '' }) filename: string,
    @Query('beatmapsetIds', {
      transform: (value?: string) => {
        const result = value?.split(';')
          .map(entry => {
            const [id, date] = entry.split(',').map(item => +item);
            if (!Number.isInteger(id))
              return;
            return Number.isInteger(date)
              ? [id, new Date(date)]
              : [id];
          })
          .filter(entry => entry);
        return result ?? [];
      }
    })
    beatmapsetIds: [beatmapsetId: number, lastModified?: Date][],
  ) {
    if (!filename.endsWith('.zip'))
      throw new Error(`filename should ends with .zip`);
    const pack = await this.appService.buildPack(beatmapsetIds);
    res
      .set('X-Archive-Files', 'zip')
      .set('Content-Disposition', `attachment; filename=${JSON.stringify(filename)}`)
      .end(pack);
  }

}
