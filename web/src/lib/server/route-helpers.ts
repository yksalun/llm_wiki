import { NextResponse } from "next/server";

import { AppError } from "./app-error";

export function okJson<T>(payload: T, status = 200) {
  return NextResponse.json(payload, { status });
}

export function errorJson(error: unknown) {
  if (error instanceof AppError) {
    const errorBody: {
      code: string;
      message: string;
      details?: Record<string, string | number | boolean | null>;
    } = {
      code: error.code,
      message: error.publicMessage,
    };

    if (error.publicDetails !== undefined) {
      errorBody.details = error.publicDetails;
    }

    return NextResponse.json(
      {
        error: errorBody,
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
