import { NextResponse } from "next/server";

import { AppError } from "./app-error";

export function okJson<T>(payload: T, status = 200) {
  return NextResponse.json(payload, { status });
}

export function errorJson(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.publicMessage,
        },
      },
      { status: error.status },
    );
  }

  console.error(error);

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "服务器处理请求时发生未知错误",
      },
    },
    { status: 500 },
  );
}
