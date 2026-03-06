import logging
import os
from logging.handlers import RotatingFileHandler

def setup_logging(app_name: str = "walksim", log_dir: str = "logs") -> logging.Logger:
    os.makedirs(log_dir, exist_ok=True)

    logger = logging.getLogger(app_name)
    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)s | %(name)s | %(threadName)s | %(message)s"
    )

    # console
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(fmt)

    # file (rotate)
    fh = RotatingFileHandler(
        os.path.join(log_dir, f"{app_name}.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)

    # 避免重複加 handler
    if not logger.handlers:
        logger.addHandler(ch)
        logger.addHandler(fh)

    # 不讓它往 root logger 再印一次
    logger.propagate = False
    return logger