import { Global, Module } from '@nestjs/common'
import { FILE_STORAGE } from './file-storage.port.js'
import { NextcloudHttpClient } from './nextcloud-http.client.js'

@Global()
@Module({
  providers: [{ provide: FILE_STORAGE, useClass: NextcloudHttpClient }],
  exports: [FILE_STORAGE],
})
export class NextcloudModule {}
