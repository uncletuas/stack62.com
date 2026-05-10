import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('API_PREFIX', 'v1');
  const port = configService.get<number>('PORT', 3000);
  const appName = configService.get<string>('APP_NAME', 'Stack62 Backend');
  const corsOrigin = configService.get<string>('CORS_ORIGIN', '*');

  // Exclude the runner preview proxy from the /v1 prefix so user systems
  // live at a clean public URL: /sys/:deploymentId/*
  app.setGlobalPrefix(apiPrefix, {
    exclude: [{ path: 'sys/(.*)', method: RequestMethod.ALL }],
  });
  app.enableCors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',') });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle(appName)
    .setDescription(
      'Stack62 backend API for multi-tenant AI-native business operating systems.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  app.enableShutdownHooks();
  await app.listen(port);
}

void bootstrap();
