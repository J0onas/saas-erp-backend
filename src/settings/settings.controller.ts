import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(AuthGuard('jwt')) // Protegemos la ruta
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('company')
  async getCompanySettings(@Req() req: any) {
    return await this.settingsService.getSettings(req.user.tenantId);
  }

  @Post('company')
  async saveCompanySettings(
    @Body() body: { business_name: string; ruc: string; address: string; email: string }, 
    @Req() req: any
  ) {
    return await this.settingsService.updateSettings(req.user.tenantId, body);
  }
}