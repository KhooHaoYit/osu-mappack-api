import { Inject, Injectable } from '@nestjs/common';
import discordCdnConfig from './discord-cdn.config';
import { ConfigType } from '@nestjs/config';
import { request } from 'undici';

@Injectable()
export class DiscordCdnService {

  constructor(
    @Inject(discordCdnConfig.KEY)
    private readonly config: ConfigType<typeof discordCdnConfig>,
  ) { }

  async generateAccessLink(url: string) {
    const { pathname } = new URL(url);
    return await request(`${this.config.url}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.userId}:${this.config.userSecret}`,
      },
    }).then(res => res.body.json() as Promise<{ jwt: string }>)
      .then(data => `${this.config.url}${pathname}?jwt=${data.jwt}`);
  }

}
