import { Controller, Get, Inject, Injectable } from '@nestjs/common'

@Injectable()
export class Repo {
  find(): string {
    return 'x'
  }
}

@Controller('demo')
export class DemoController {
  constructor(
    private readonly repo: Repo,
    @Inject('TOKEN') private readonly token: string,
  ) {}

  @Get()
  async list(): Promise<{ value: string; token: string }> {
    return { value: this.repo.find(), token: this.token }
  }
}
