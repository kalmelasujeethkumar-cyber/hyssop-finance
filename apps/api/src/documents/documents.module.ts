import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getAppEnvironment } from '../config/environment';
import { DatabaseModule } from '../database/database.module';
import { DOCUMENT_STORAGE } from '../storage/document-storage';
import { LocalDocumentStorage } from '../storage/local-document-storage';
import { S3DocumentStorage } from '../storage/s3-document-storage';
import { DocumentsController, TransactionDocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [DocumentsController, TransactionDocumentsController],
  providers: [
    DocumentsService,
    LocalDocumentStorage,
    {
      provide: DOCUMENT_STORAGE,
      useFactory: (config: ConfigService, local: LocalDocumentStorage) =>
        getAppEnvironment(config).storage.driver === 's3' ? new S3DocumentStorage(config) : local,
      inject: [ConfigService, LocalDocumentStorage],
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
