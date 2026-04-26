import { UserRole } from "src/entities/user.entity";
import { Role } from "../enums/role.enums";

export type CurrentUser = {
    id: string;
    email: string;
    role: UserRole | null;
};