import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ListMembershipsDto } from './dto/list-memberships.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('memberships')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @RequireAccess({
    resource: 'membership',
    action: 'manage_memberships',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post()
  create(@Body() payload: CreateMembershipDto, @CurrentUser() user: JwtUser) {
    return this.membershipsService.create(payload, user.userId);
  }

  @Post('invite')
  invite(@Body() payload: InviteMemberDto, @CurrentUser() user: JwtUser) {
    return this.membershipsService.inviteMember(payload, user.userId);
  }

  /**
   * Public-readable invite preview. The token is opaque and unguessable
   * (32 random bytes), so exposing the org name to whoever holds the
   * token is fine — they need that copy to decide whether to accept.
   * Returns 404 for expired/used tokens so we don't leak past invites.
   */
  @Public()
  @Get('invites/lookup/:token')
  lookupInvite(@Param('token') token: string) {
    return this.membershipsService.lookupInvite(token);
  }

  @Post('accept-invite')
  acceptInvite(@Body() payload: AcceptInviteDto, @CurrentUser() user: JwtUser) {
    return this.membershipsService.acceptInvite(payload, user.userId);
  }

  @RequireAccess({
    resource: 'membership',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListMembershipsDto, @CurrentUser() user: JwtUser) {
    return this.membershipsService.findAll(query, user.userId);
  }

  @Get('invites')
  findInvites(
    @Query('organizationId') orgId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.membershipsService.findPendingInvites(orgId, user.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() payload: UpdateMembershipDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.membershipsService.updateMembership(id, payload, user.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.membershipsService.removeMember(id, user.userId);
  }
}
