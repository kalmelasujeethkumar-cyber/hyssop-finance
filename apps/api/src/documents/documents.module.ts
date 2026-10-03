import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
      provide: S3DocumentStorage,
      useFactory: (config: ConfigService) => new S3DocumentStorage(config),
      inject: [ConfigService],
    },
    {
      provide: DOCUMENT_STORAGE,
      useFactory: (
        config: ConfigService,
        local: LocalDocumentStorage,
        s3: S3DocumentStorage,
      ) => config.get<string>('STORAGE_DRIVER') === 's3' ? s3 : local,
      inject: [ConfigService, LocalDocumentStorage, S3DocumentStorage],
    },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
