import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../shared/decorators/public.decorator';
import { PaymentsService } from './payments.service';

/**
 * Paystack webhook receiver. Public (Paystack has no bearer token) but every
 * call is signature-verified against PAYSTACK_SECRET_KEY before we trust it.
 * main.ts enables rawBody so we can HMAC the exact bytes Paystack signed.
 */
@Controller('billing/webhook')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('paystack')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async paystack(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature?: string,
  ) {
    if (!this.paymentsService.verifyPaystackSignature(req.rawBody, signature)) {
      throw new ForbiddenException('Invalid Paystack signature.');
    }
    await this.paymentsService.recordPaystackEvent(req.body);
    return { received: true };
  }
}
