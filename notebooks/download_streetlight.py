from roboflow import Roboflow

rf = Roboflow(api_key="yECzryjdWfFzxQwYyGhh")  # same key jo pehle use ki thi

project = rf.workspace("godspeed-yqpeo").project("damaged-lights")
version = project.version(1)
dataset = version.download("yolov8", location="datasets/civic_detection_raw/streetlight")

print("Download complete:", dataset.location)