import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  try {
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  } catch {
    logger.warn('ValidationPipe disabled: class-validator/class-transformer missing in runtime image.');
  }

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}

bootstrap();
