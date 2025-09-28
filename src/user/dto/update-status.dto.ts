import { IsBoolean } from "class-validator";

class UpdateStatusDto {
    @IsBoolean()
    new_user: boolean;
}