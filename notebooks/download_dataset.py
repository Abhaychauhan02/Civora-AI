from roboflow import Roboflow

rf = Roboflow(api_key="yECzryjdWfFzxQwYyGhh")

# Smartathon dataset — pothole + garbage
project = rf.workspace("cut-wjpqy").project("smartathon-0z6br")
version = project.version(1)  # check exact version number on the site if this fails
dataset = version.download("yolov8", location="datasets/civic_detection_raw/smartathon")

print("Download complete:", dataset.location)