import { UserRole } from "src/entities/user.entity";
import { Role } from "../enums/role.enums";

export type CurrentUser = {
    id: string;
    role: UserRole;
};